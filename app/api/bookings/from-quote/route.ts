import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canWrite, canAccessRecord, logActivity, getIp, notify } from "@/lib/auth";
import { makeRef } from "@/lib/registry";
import { profitAndMargin } from "@/lib/currency";

export const dynamic = "force-dynamic";

// Quote statuses from which a booking may be created. A booking represents an
// accepted commercial commitment, so only a quote the customer could plausibly
// have accepted qualifies. Draft/Rejected/Expired/Superseded are blocked.
const CONVERTIBLE = new Set(["Sent", "Accepted"]);

// POST { quoteId } — accept a quote and convert it into a provisional booking
// (Module 11). Validated, transactional and idempotent (P0-06): a repeated or
// concurrent call returns the booking that already exists for the quote rather
// than creating a duplicate.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canWrite(session.role, "bookings")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const { quoteId } = await req.json();
  const qid = Number(quoteId);
  if (!qid) return NextResponse.json({ error: "quoteId is required" }, { status: 400 });

  const quote = await prisma.quote.findUnique({
    where: { id: qid },
    include: { lead: true, items: { include: { serviceLine: true } } },
  });
  if (!quote || quote.deletedAt) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  const lead = quote.lead;
  // object-level authorisation: an agent may only convert their own lead's quote
  if (!canAccessRecord(session, lead, "assignedToId")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Idempotency: if this quote already produced a booking, return it unchanged.
  const already = await prisma.booking.findUnique({ where: { quoteId: quote.id } });
  if (already) {
    return NextResponse.json({ booking: { id: already.id, bookingRef: already.bookingRef }, existing: true }, { status: 200 });
  }

  // Validity gates.
  if (!CONVERTIBLE.has(quote.status)) {
    return NextResponse.json(
      { error: `A ${quote.status} quote cannot be converted. Send the quote to the customer first.` },
      { status: 409 }
    );
  }
  if (quote.validUntil && new Date(quote.validUntil) < new Date()) {
    return NextResponse.json({ error: "This quote has expired. Rebuild and resend it before converting." }, { status: 409 });
  }
  const customerPrice = quote.customerPrice || 0;
  if (customerPrice <= 0) {
    return NextResponse.json({ error: "Quote has no positive customer price to bill." }, { status: 409 });
  }
  if (!lead) return NextResponse.json({ error: "Quote has no associated lead." }, { status: 409 });

  const supplierCost = quote.supplierCost || 0;
  const { profit, margin } = profitAndMargin(supplierCost, customerPrice);
  const firstSL = quote.items.find((i) => i.serviceLine?.supplierId)?.serviceLine;

  // One transaction covers booking create + ref stamp + quote/lead status so a
  // partial failure can never leave the three records inconsistent (P0-06).
  let booking;
  try {
    booking = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.create({
        data: {
          leadId: lead.id,
          quoteId: quote.id,
          brandId: quote.brandId,
          customerId: lead.customerId,
          agentId: lead.assignedToId,
          supplierId: firstSL?.supplierId ?? null,
          countryId: lead.countryId,
          city: lead.city,
          travelDate: lead.travelDate ?? firstSL?.travelDate ?? null,
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
          // Provisional until supplier confirmation + payment rule are met.
          status: "Awaiting Customer Payment",
        },
      });
      const withRef = await tx.booking.update({
        where: { id: b.id },
        data: { bookingRef: makeRef("B", b.id) },
      });
      await tx.quote.update({ where: { id: quote.id }, data: { status: "Accepted", acceptedAt: new Date() } });
      await tx.lead.update({ where: { id: lead.id }, data: { status: "Won / Confirmed" } });
      await tx.leadStatusHistory.create({ data: { leadId: lead.id, fromStatus: lead.status, toStatus: "Won / Confirmed", userId: session.id } });
      return withRef;
    });
  } catch (e: any) {
    // Unique violation on quoteId means a concurrent request won the race.
    if (e?.code === "P2002") {
      const existing = await prisma.booking.findUnique({ where: { quoteId: quote.id } });
      if (existing) return NextResponse.json({ booking: { id: existing.id, bookingRef: existing.bookingRef }, existing: true }, { status: 200 });
    }
    return NextResponse.json({ error: e.message || "Conversion failed" }, { status: 400 });
  }

  await logActivity({ userId: session.id, action: "convert", entityType: "bookings", entityId: booking.id, newValue: `from quote ${quote.quoteRef}`, ip: getIp(req) });
  const finance = await prisma.user.findMany({ where: { role: { in: ["FINANCE", "MANAGER"] }, active: true } });
  for (const f of finance) await notify(f.id, "New booking — awaiting customer payment", `${booking.bookingRef} • ${lead.customerName}`, `/bookings/${booking.id}`);

  return NextResponse.json({ booking: { id: booking.id, bookingRef: booking.bookingRef } }, { status: 201 });
}
