// ─────────────────────────────────────────────────────────────────────────────
// Data migration / backfill for the flat-booking → independent-facts + legs model.
//
// Idempotent and production-safe. Runs at deploy time (see render.yaml) AFTER
// `prisma db push`, and can be re-run any number of times:
//
//   • Every existing flat Booking gets exactly ONE BookingLeg carrying its
//     commercial + itinerary snapshot (skipped if it already has legs).
//   • The legacy `Booking.status` is mapped conservatively into the new
//     orthogonal facts (operationalStage / customerAcceptance / financialClosure)
//     WITHOUT ever regressing a further-advanced booking.
//   • Paid totals are recomputed from the immutable Payment ledger, not trusted
//     from stored values.
//   • Legacy Payment rows are classified (kind) and given reporting-currency
//     amounts so the new Decimal ledger is complete.
//
// It NEVER deletes or overwrites financial history and NEVER drops rows.
// ─────────────────────────────────────────────────────────────────────────────
const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient();

const BASE = (process.env.BASE_CURRENCY || "USD").toUpperCase();
const D = (v) => new Prisma.Decimal(v == null || isNaN(Number(v)) ? 0 : v);

// Conservative legacy-status → operational-stage map. Anything not listed stays
// PROVISIONAL so the new confirmation policy re-evaluates it rather than the
// migration silently declaring a booking confirmed.
function mapStage(status) {
  switch (status) {
    case "Cancelled": return "CANCELLED";
    case "Closed": return "COMPLETED";
    case "Travel Completed": return "COMPLETED";
    case "Travel Scheduled":
    case "Supplier Confirmed": return "CONFIRMED";
    default: return "PROVISIONAL";
  }
}

// Whether the legacy status implies the supplier had committed to the leg.
function mapSupplierConfirmation(status, hasSupplier) {
  if (["Supplier Confirmed", "Supplier Paid", "Travel Scheduled", "Travel Completed", "Closed"].includes(status)) {
    return hasSupplier ? "ACCEPTED" : "REQUESTED";
  }
  return hasSupplier ? "REQUESTED" : "UNASSIGNED";
}

async function convertAmount(amount, from, to) {
  const f = (from || BASE).toUpperCase();
  const t = (to || BASE).toUpperCase();
  if (!amount) return 0;
  if (f === t) return Number(amount);
  const r = await prisma.exchangeRate.findUnique({ where: { base_quote: { base: f, quote: t } } }).catch(() => null);
  if (r && r.rate) return Math.round(Number(amount) * Number(r.rate) * 100) / 100;
  return Number(amount); // no rate — keep nominal rather than corrupt the value
}

async function backfillBookings() {
  const bookings = await prisma.booking.findMany({ include: { legs: { select: { id: true } } } });
  let legsCreated = 0;
  let bookingsTouched = 0;

  for (const b of bookings) {
    // 1) Recompute paid totals from the ledger (immutable Payment rows).
    const paidRows = await prisma.payment.findMany({ where: { bookingId: b.id, status: "Paid" } });
    let customerPaid = 0, supplierPaid = 0;
    for (const p of paidRows) {
      const target = (p.party === "customer" ? b.customerCurrency : b.supplierCurrency) || BASE;
      const val = await convertAmount(p.amount, p.currency, target);
      if (p.party === "customer") customerPaid += val; else supplierPaid += val;
    }
    customerPaid = Math.round(customerPaid * 100) / 100;
    supplierPaid = Math.round(supplierPaid * 100) / 100;

    // 2) Map legacy status → orthogonal facts. Never regress an already-set stage.
    const stage = b.operationalStage && b.operationalStage !== "PROVISIONAL" ? b.operationalStage : mapStage(b.status);
    // Bookings exist because a customer committed (created from an accepted quote),
    // so acceptance is ACCEPTED unless already explicitly withdrawn.
    const acceptance = b.customerAcceptance === "WITHDRAWN" ? "WITHDRAWN" : "ACCEPTED";
    const closure = b.status === "Closed" ? "RECONCILED" : (b.financialClosure || "OPEN");

    const patch = {
      operationalStage: stage,
      customerAcceptance: acceptance,
      financialClosure: closure,
      customerPaidAmount: customerPaid,
      supplierPaidAmount: supplierPaid,
    };

    // 3) One leg per booking, if it has none.
    if (!b.legs || b.legs.length === 0) {
      await prisma.bookingLeg.create({
        data: {
          bookingId: b.id,
          legIndex: 1,
          serviceLineId: null,
          serviceDate: b.travelDate,
          serviceTime: b.travelTime,
          pickupLocation: b.pickupLocation,
          dropoffLocation: b.dropoffLocation,
          passengerCount: b.passengerCount,
          supplierId: b.supplierId,
          supplierAmount: D(b.supplierCost),
          supplierCurrency: b.supplierCurrency || BASE,
          customerAmount: D(b.customerInvoiceAmount),
          customerCurrency: b.customerCurrency || BASE,
          fxRate: D(b.exchangeRate || 1),
          supplierConfirmation: mapSupplierConfirmation(b.status, !!b.supplierId),
          readiness: stage === "CONFIRMED" || stage === "COMPLETED" ? "ATTENTION" : "BLOCKED",
        },
      });
      legsCreated++;
    }

    await prisma.booking.update({ where: { id: b.id }, data: patch });
    bookingsTouched++;
  }
  return { legsCreated, bookingsTouched };
}

async function backfillPayments() {
  // Classify legacy ledger rows and populate reporting-currency amounts.
  const rows = await prisma.payment.findMany();
  let touched = 0;
  for (const p of rows) {
    const data = {};
    // kind: legacy rows only carried party/direction.
    if (!p.kind || p.kind === "receipt") {
      if (p.party === "supplier") data.kind = "supplier_payment";
      else if (p.status === "Refunded") data.kind = "refund";
      else data.kind = "receipt";
    }
    // reporting amount: legacy `baseAmount` held the base-reporting-currency value.
    if (p.reportingAmount == null && p.baseAmount != null) {
      data.reportingAmount = p.baseAmount;
      data.reportingCurrency = BASE;
    }
    if (!p.fxSource) data.fxSource = "manual";
    if (Object.keys(data).length) {
      await prisma.payment.update({ where: { id: p.id }, data });
      touched++;
    }
  }
  return touched;
}

async function main() {
  console.log("→ Backfilling booking legs + independent workflow facts…");
  const { legsCreated, bookingsTouched } = await backfillBookings();
  const paymentsTouched = await backfillPayments();
  console.log(`✅ Backfill complete: ${bookingsTouched} bookings updated, ${legsCreated} legs created, ${paymentsTouched} payment rows classified.`);
}

main()
  .catch((e) => { console.error("Backfill failed:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
