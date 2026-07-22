import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canWrite, canAccessRecord, logActivity, getIp, notify } from "@/lib/auth";
import { makeRef } from "@/lib/registry";
import { profitAndMargin } from "@/lib/currency";
import { parseBody, z, optionalNote } from "@/lib/validation";

export const dynamic = "force-dynamic";

// POST /api/quotes/:id/record-acceptance
// First-class customer-acceptance event (replaces the old "Convert"). Records that
// the customer accepted a specific quote version, and — in ONE transaction —
// creates exactly one PROVISIONAL booking with one leg per accepted quote item,
// snapshotting the accepted commercials. Idempotent: a repeat/concurrent call
// returns the existing booking (Booking.quoteId is unique). Never marks the lead
// Won/Confirmed prematurely — it becomes provisional / customer-accepted.
const Body = z.object({
  channel: z.enum(["phone", "whatsapp", "email", "in_person", "other"]).default("other"),
  acceptedAt: z.coerce.date().optional(),
  notes: optionalNote,
  evidenceRef: z.string().trim().max(500).optional().nullable(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canWrite(session.role, "bookings")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const qid = Number((await ctx.params).id);
  if (!qid) return NextResponse.json({ error: "Invalid quote id" }, { status: 400 });

  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.res;
  const { channel, notes, evidenceRef } = parsed.data;
  const acceptedAt = parsed.data.acceptedAt || new Date();

  const quote = await prisma.quote.findUnique({
    where: { id: qid },
    include: { lead: true, items: { include: { serviceLine: true } }, paymentPlans: { include: { milestones: true } } },
  });
  if (!quote || quote.deletedAt) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  const lead = quote.lead;
  if (!lead) return NextResponse.json({ error: "Quote has no associated lead." }, { status: 409 });
  // Object-level authorisation: an agent may only accept their own lead's quote.
  if (!canAccessRecord(session, lead, "assignedToId")) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Idempotency: a booking already exists for this quote → return it unchanged.
  const already = await prisma.booking.findUnique({ where: { quoteId: quote.id } });
  if (already) {
    return NextResponse.json({ booking: { id: already.id, bookingRef: already.bookingRef }, existing: true }, { status: 200 });
  }

  // ── Validity gates ──
  // Only a Sent (customer-visible) quote can be accepted. Draft/Rejected/Expired/
  // Superseded/Accepted-elsewhere cannot create a booking.
  if (quote.status !== "Sent") {
    return NextResponse.json(
      { error: `A ${quote.status} quote cannot record acceptance — send the current quote to the customer first.` },
      { status: 409 }
    );
  }
  if (quote.validUntil && new Date(quote.validUntil) < new Date()) {
    return NextResponse.json({ error: "This quote has expired. Rebuild and resend it before recording acceptance." }, { status: 409 });
  }
  const customerPrice = quote.customerPrice || 0;
  if (customerPrice <= 0) {
    return NextResponse.json({ error: "Quote has no positive customer price to bill." }, { status: 409 });
  }
  if (!quote.items.length) {
    return NextResponse.json({ error: "Quote has no line items to turn into booking legs." }, { status: 409 });
  }
  // Complete pricing: every item must carry a positive customer price.
  const incomplete = quote.items.find((i) => !(i.customerPrice && i.customerPrice > 0));
  if (incomplete) {
    return NextResponse.json({ error: `Quote item "${incomplete.description}" has no customer price. Complete pricing before acceptance.` }, { status: 409 });
  }

  const supplierCost = quote.supplierCost || 0;
  const { profit, margin } = profitAndMargin(supplierCost, customerPrice);
  const firstSupplierLine = quote.items.find((i) => i.serviceLine?.supplierId)?.serviceLine;
  const draftPlan = quote.paymentPlans[0]; // plan chosen while quoting, if any

  let booking;
  try {
    booking = await prisma.$transaction(async (tx) => {
      // 1) Snapshot the payment plan (immutable copy tied to the booking).
      let planId: number | null = null;
      if (draftPlan) {
        const snap = await tx.paymentPlan.create({
          data: {
            planType: draftPlan.planType,
            depositPercent: draftPlan.depositPercent,
            depositAmount: draftPlan.depositAmount,
            currency: draftPlan.currency,
            creditApproved: draftPlan.creditApproved,
            creditApprovedById: draftPlan.creditApprovedById,
            creditTermsDays: draftPlan.creditTermsDays,
            milestones: {
              create: (draftPlan.milestones || []).map((m: any) => ({
                label: m.label, amount: m.amount, currency: m.currency,
                dueBasis: m.dueBasis, dueOffsetDays: m.dueOffsetDays,
                isConfirmation: m.isConfirmation, sortOrder: m.sortOrder,
              })),
            },
          },
        });
        planId = snap.id;
      }

      // 2) Create the provisional booking (customer accepted, nothing else yet).
      const b = await tx.booking.create({
        data: {
          leadId: lead.id,
          quoteId: quote.id,
          brandId: quote.brandId,
          customerId: lead.customerId,
          agentId: lead.assignedToId, // stays the sales agent — no ops handoff
          supplierId: firstSupplierLine?.supplierId ?? null,
          countryId: lead.countryId,
          city: lead.city,
          travelDate: lead.travelDate ?? firstSupplierLine?.travelDate ?? null,
          travelTime: lead.travelTime,
          pickupLocation: lead.pickupLocation,
          dropoffLocation: lead.dropoffLocation,
          passengerCount: lead.passengerCount,
          customerCurrency: quote.customerCurrency,
          supplierCurrency: quote.supplierCurrency,
          exchangeRate: quote.exchangeRate,
          customerInvoiceAmount: customerPrice,
          supplierCost,
          grossProfit: profit,
          margin,
          operationalStage: "PROVISIONAL",
          customerAcceptance: "ACCEPTED",
          financialClosure: "OPEN",
          paymentPlanId: planId,
          status: "Awaiting Customer Payment", // legacy display
        },
      });
      const withRef = await tx.booking.update({ where: { id: b.id }, data: { bookingRef: makeRef("B", b.id) } });

      // 3) One immutable leg per accepted quote item (commercial + itinerary snapshot).
      let idx = 0;
      for (const item of quote.items) {
        idx++;
        const sl = item.serviceLine;
        await tx.bookingLeg.create({
          data: {
            bookingId: b.id,
            legIndex: idx,
            quoteItemId: item.id,
            serviceLineId: item.serviceLineId,
            serviceType: sl?.serviceType,
            serviceDate: sl?.travelDate ?? lead.travelDate,
            serviceTime: sl?.travelTime ?? lead.travelTime,
            timezone: lead.timezone,
            pickupLocation: sl?.pickupLocation ?? lead.pickupLocation,
            dropoffLocation: sl?.dropoffLocation ?? lead.dropoffLocation,
            passengerCount: sl?.passengerCount ?? lead.passengerCount,
            vehicleRequirement: sl?.vehicleRequirement,
            supplierId: sl?.supplierId ?? null,
            supplierAmount: item.supplierCost ?? sl?.supplierCost ?? 0,
            supplierCurrency: item.currency ?? quote.supplierCurrency,
            customerAmount: item.customerPrice ?? 0,
            customerCurrency: item.currency ?? quote.customerCurrency,
            fxRate: quote.exchangeRate ?? 1,
            supplierConfirmation: sl?.supplierId ? "REQUESTED" : "UNASSIGNED",
          },
        });
      }

      // 4) Quote/lead status. Lead becomes provisional — NOT Won/Confirmed.
      await tx.quote.update({ where: { id: quote.id }, data: { status: "Accepted", acceptedAt } });
      await tx.lead.update({ where: { id: lead.id }, data: { status: "Booking Provisional" } });
      await tx.leadStatusHistory.create({ data: { leadId: lead.id, fromStatus: lead.status, toStatus: "Booking Provisional", userId: session.id } });

      // 5) Initial operational tasks for the sales agent.
      const travel = lead.travelDate ? new Date(lead.travelDate) : null;
      const soon = new Date(Date.now() + 2 * 86400000);
      await tx.task.createMany({
        data: [
          { title: `Record supplier acceptance — ${withRef.bookingRef}`, taskType: "supplier_acceptance", leadId: lead.id, assignedToId: lead.assignedToId, createdById: session.id, dueDate: soon, priority: "High", status: "Open" },
          { title: `Collect customer deposit — ${withRef.bookingRef}`, taskType: "payment", leadId: lead.id, assignedToId: lead.assignedToId, createdById: session.id, dueDate: soon, priority: "High", status: "Open" },
          { title: `Confirm driver & vehicle details — ${withRef.bookingRef}`, taskType: "trip_details", leadId: lead.id, assignedToId: lead.assignedToId, createdById: session.id, dueDate: travel || soon, priority: "Medium", status: "Open" },
        ],
      });

      // 6) One correlated business event carrying the acceptance snapshot.
      await tx.businessEvent.create({
        data: {
          type: "customer_accepted",
          bookingId: b.id,
          correlationId: `quote-${quote.id}`,
          userId: session.id,
          data: JSON.stringify({
            quoteId: quote.id, quoteRef: quote.quoteRef, quoteVersion: quote.version,
            channel, acceptedAt, evidenceRef: evidenceRef || null, notes: notes || null,
            customerPrice, currency: quote.customerCurrency,
            items: quote.items.map((i) => ({ id: i.id, description: i.description, customerPrice: i.customerPrice, currency: i.currency })),
          }),
        },
      });

      return withRef;
    });
  } catch (e: any) {
    // Unique violation on quoteId → a concurrent request won the race.
    if (e?.code === "P2002") {
      const existing = await prisma.booking.findUnique({ where: { quoteId: quote.id } });
      if (existing) return NextResponse.json({ booking: { id: existing.id, bookingRef: existing.bookingRef }, existing: true }, { status: 200 });
    }
    return NextResponse.json({ error: e.message || "Recording acceptance failed" }, { status: 400 });
  }

  await logActivity({ userId: session.id, action: "record_acceptance", entityType: "bookings", entityId: booking.id, newValue: `quote ${quote.quoteRef} via ${channel}`, ip: getIp(req) });
  const finance = await prisma.user.findMany({ where: { role: { in: ["FINANCE", "MANAGER"] }, active: true } });
  for (const f of finance) await notify(f.id, "New provisional booking — customer accepted", `${booking.bookingRef} • ${lead.customerName}`, `/bookings/${booking.id}`);

  return NextResponse.json({ booking: { id: booking.id, bookingRef: booking.bookingRef } }, { status: 201 });
}
