import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canWrite, canAccessRecord, logActivity, getIp, notify } from "@/lib/auth";
import { convert, baseCurrency, getRate } from "@/lib/currency";
import { recomputeBookingPaid } from "@/lib/payments";
import { evaluateConfirmation } from "@/lib/policy";
import { parseBody, z, isoCurrency, positiveAmount, optionalNote } from "@/lib/validation";

export const dynamic = "force-dynamic";

// POST /api/payments/record — record a CUSTOMER receipt against a booking the agent
// is authorised to manage (business rules 2, 3). Posts an immutable ledger row that
// updates the balance immediately but stays Unreconciled until finance matches it.
// Supplier payouts, refunds, reversals and reconciliation are finance-only and live
// on their own command endpoints — this endpoint never touches them.
//
// Integrity: positive amount, ISO currency, blocked missing FX, client idempotency
// key (a retried POST is a no-op), and prohibited overpayment unless a manager/admin
// supplies an explicit override + reason.
const Body = z.object({
  bookingId: z.coerce.number().int().positive(),
  amount: positiveAmount,
  currency: isoCurrency.optional(),
  method: z.string().trim().min(1).max(60).default("Bank transfer"),
  receivedAt: z.coerce.date().optional(),
  reference: z.string().trim().max(200).optional().nullable(),
  notes: optionalNote,
  evidenceRef: z.string().trim().max(500).optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(200).optional().nullable(),
  overpaymentOverride: z.boolean().optional(),
  overrideReason: z.string().trim().max(500).optional().nullable(),
});

const EPS = 0.005;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canWrite(session.role, "payments")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  // Idempotency: a retried/duplicated receipt with the same key is a no-op.
  if (body.idempotencyKey) {
    const dup = await prisma.payment.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
    if (dup) return NextResponse.json({ ok: true, existing: true, paymentId: dup.id });
  }

  const booking = await prisma.booking.findUnique({ where: { id: body.bookingId } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  // Agents may only post receipts against their own bookings (business rule 2).
  if (!canAccessRecord(session, booking, "agentId")) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const currency = (body.currency || booking.customerCurrency || baseCurrency()).toUpperCase();
  const bookingCurrency = (booking.customerCurrency || baseCurrency()).toUpperCase();

  // Validate FX exists for both the booking-currency and reporting-currency views.
  const rateToReporting = await getRate(currency, baseCurrency());
  if (!isFinite(rateToReporting)) {
    return NextResponse.json({ error: `No exchange rate for ${currency} → ${baseCurrency()}. Add one under Settings → Currency.` }, { status: 422 });
  }
  const amountInBooking = await convert(body.amount, currency, bookingCurrency);
  const reportingAmount = await convert(body.amount, currency, baseCurrency());
  if (!isFinite(amountInBooking) || !isFinite(reportingAmount)) {
    return NextResponse.json({ error: `Missing exchange rate to value this receipt in ${bookingCurrency}/${baseCurrency()}.` }, { status: 422 });
  }

  // Prohibited overpayment: the new receipt must not push the customer above the
  // invoice total unless a manager/admin explicitly overrides with a reason.
  const invoice = Number(booking.customerInvoiceAmount || 0);
  const alreadyPaid = Number(booking.customerPaidAmount || 0);
  if (invoice > 0 && alreadyPaid + amountInBooking > invoice + EPS) {
    const canOverride = ["MANAGER", "ADMIN"].includes(session.role);
    if (!(body.overpaymentOverride && canOverride && body.overrideReason)) {
      return NextResponse.json(
        {
          error: `This receipt (${amountInBooking.toFixed(2)} ${bookingCurrency}) would overpay the invoice (paid ${alreadyPaid.toFixed(2)} of ${invoice.toFixed(2)}). A manager/admin override with a reason is required.`,
          overpayment: true,
        },
        { status: 409 }
      );
    }
  }

  let result: any;
  try {
    result = await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          bookingId: booking.id,
          party: "customer",
          direction: "in",
          kind: "receipt",
          amount: body.amount,
          currency,
          baseAmount: amountInBooking,
          reportingAmount,
          reportingCurrency: baseCurrency(),
          exchangeRate: rateToReporting,
          fxSource: "api",
          method: body.method,
          reference: body.reference ?? null,
          notes: body.notes ?? null,
          status: "Paid",
          paidAt: body.receivedAt || new Date(),
          reconciledAt: null, // Unreconciled until finance matches it
          idempotencyKey: body.idempotencyKey ?? null,
          recordedById: session.id,
        },
      });
      const rolled = await recomputeBookingPaid(tx, booking.id);
      const confirmation = await evaluateConfirmation(tx, booking.id, session.id);
      return { rolled, confirmation };
    });
  } catch (e: any) {
    // Concurrent duplicate with the same idempotency key won the race.
    if (e?.code === "P2002") {
      const dup = body.idempotencyKey ? await prisma.payment.findUnique({ where: { idempotencyKey: body.idempotencyKey } }) : null;
      if (dup) return NextResponse.json({ ok: true, existing: true, paymentId: dup.id });
    }
    return NextResponse.json({ error: e.message || "Recording receipt failed" }, { status: 400 });
  }

  await logActivity({ userId: session.id, action: "receipt", entityType: "bookings", entityId: booking.id, newValue: `customer ${currency} ${body.amount}`, ip: getIp(req) });
  const finance = await prisma.user.findMany({ where: { role: { in: ["FINANCE", "MANAGER"] }, active: true } });
  for (const f of finance) await notify(f.id, "Customer receipt (unreconciled)", `${booking.bookingRef || booking.id}: ${currency} ${body.amount}`, `/bookings/${booking.id}`);

  return NextResponse.json({ ok: true, confirmed: result.confirmation?.changed || false, ...(result.rolled || {}) });
}
