import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canWrite, logActivity, getIp, notify } from "@/lib/auth";
import { makeRef } from "@/lib/registry";
import { profitAndMargin } from "@/lib/currency";

export const dynamic = "force-dynamic";

// POST { quoteId } — accept a quote and convert it into a booking (Module 11).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canWrite(session.role, "bookings")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const { quoteId } = await req.json();
  const quote = await prisma.quote.findUnique({
    where: { id: Number(quoteId) },
    include: { lead: true, items: { include: { serviceLine: true } } },
  });
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  const lead = quote.lead;
  const supplierCost = quote.supplierCost || 0;
  const customerPrice = quote.customerPrice || 0;
  const { profit, margin } = profitAndMargin(supplierCost, customerPrice);
  // pick the supplier from the first service line that has one
  const firstSL = quote.items.find((i) => i.serviceLine?.supplierId)?.serviceLine;

  const booking = await prisma.booking.create({
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
      status: "Awaiting Customer Payment",
    },
  });
  const ref = makeRef("B", booking.id);
  await prisma.booking.update({ where: { id: booking.id }, data: { bookingRef: ref } });

  await prisma.quote.update({ where: { id: quote.id }, data: { status: "Accepted", acceptedAt: new Date() } });
  await prisma.lead.update({ where: { id: lead.id }, data: { status: "Won / Confirmed" } });
  await prisma.leadStatusHistory.create({ data: { leadId: lead.id, fromStatus: lead.status, toStatus: "Won / Confirmed", userId: session.id } });

  await logActivity({ userId: session.id, action: "convert", entityType: "bookings", entityId: booking.id, newValue: `from quote ${quote.quoteRef}`, ip: getIp(req) });
  const finance = await prisma.user.findMany({ where: { role: { in: ["FINANCE", "MANAGER"] }, active: true } });
  for (const f of finance) await notify(f.id, "New booking — awaiting customer payment", `${ref} • ${lead.customerName}`, `/bookings/${booking.id}`);

  return NextResponse.json({ booking: { id: booking.id, bookingRef: ref } }, { status: 201 });
}
