import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, raiseAlert } from "@/lib/auth";
import { LEAD_OPEN_STATUSES } from "@/lib/constants";

export const dynamic = "force-dynamic";

// POST — scan the system and (re)raise operational alerts (Module 21).
// Idempotent-ish: only raises an alert if an unresolved one of the same
// type+entity doesn't already exist.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const now = new Date();
  const in3days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  let raised = 0;

  const existing = await prisma.alert.findMany({ where: { resolvedAt: null }, select: { type: true, entityType: true, entityId: true } });
  const seen = new Set(existing.map((a) => `${a.type}:${a.entityType}:${a.entityId}`));
  const once = async (key: string, fn: () => Promise<void>) => {
    if (seen.has(key)) return;
    await fn();
    seen.add(key);
    raised++;
  };

  // 1) SLA breaches — open leads past slaDueAt with no first response
  const slaLeads = await prisma.lead.findMany({
    where: { deletedAt: null, firstResponseAt: null, slaDueAt: { lt: now }, status: { in: LEAD_OPEN_STATUSES } },
    select: { id: true, customerName: true, slaDueAt: true },
  });
  for (const l of slaLeads) {
    await prisma.lead.update({ where: { id: l.id }, data: { slaBreached: true } });
    await once(`sla_breach:leads:${l.id}`, () =>
      raiseAlert({ type: "sla_breach", severity: "critical", title: `SLA breach: ${l.customerName}`, body: `No first response by ${new Date(l.slaDueAt!).toLocaleString("en-GB")}`, entityType: "leads", entityId: l.id })
    );
  }

  // 2) Suppliers not responding — request open > 4h
  const fourHrsAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const slowReqs = await prisma.supplierQuoteRequest.findMany({
    where: { respondedAt: null, outcome: "Pending", sentAt: { lt: fourHrsAgo } },
    include: { supplier: { select: { companyName: true } } },
  });
  for (const r of slowReqs) {
    await once(`supplier_no_response:supplierRequests:${r.id}`, () =>
      raiseAlert({ type: "supplier_no_response", severity: "warning", title: `Supplier slow to respond: ${r.supplier.companyName}`, body: `Quote request open since ${new Date(r.sentAt).toLocaleString("en-GB")}`, entityType: "supplierRequests", entityId: r.id })
    );
  }

  // 3) Booking near travel but customer unpaid
  const soon = await prisma.booking.findMany({
    where: { deletedAt: null, travelDate: { gte: now, lt: in3days }, status: { notIn: ["Cancelled", "Closed"] } },
    select: { id: true, bookingRef: true, customerInvoiceAmount: true, customerPaidAmount: true, supplierCost: true, supplierPaidAmount: true, travelDate: true },
  });
  for (const b of soon) {
    if ((b.customerPaidAmount || 0) < (b.customerInvoiceAmount || 0)) {
      await once(`customer_unpaid_travel:bookings:${b.id}`, () =>
        raiseAlert({ type: "customer_unpaid_travel", severity: "critical", title: `Customer unpaid before travel: ${b.bookingRef}`, body: `Travel ${new Date(b.travelDate!).toLocaleDateString("en-GB")}`, entityType: "bookings", entityId: b.id })
      );
    }
    if ((b.supplierPaidAmount || 0) < (b.supplierCost || 0)) {
      await once(`supplier_unpaid_travel:bookings:${b.id}`, () =>
        raiseAlert({ type: "supplier_unpaid_travel", severity: "warning", title: `Supplier unpaid before travel: ${b.bookingRef}`, body: `Travel ${new Date(b.travelDate!).toLocaleDateString("en-GB")}`, entityType: "bookings", entityId: b.id })
      );
    }
  }

  // 4) Quote sent but not followed up in 3 days
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const staleQuotes = await prisma.quote.findMany({
    where: { deletedAt: null, status: "Sent", sentAt: { lt: threeDaysAgo } },
    select: { id: true, quoteRef: true },
  });
  for (const q of staleQuotes) {
    await once(`quote_no_followup:quotes:${q.id}`, () =>
      raiseAlert({ type: "quote_no_followup", severity: "info", title: `Quote needs follow-up: ${q.quoteRef}`, body: "Sent over 3 days ago, no response.", entityType: "quotes", entityId: q.id })
    );
  }

  return NextResponse.json({ raised });
}
