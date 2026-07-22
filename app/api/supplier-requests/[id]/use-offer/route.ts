import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canWrite, canAccessRecord, logActivity, getIp } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/supplier-requests/:id/use-offer
// One command that ties a supplier's price response to its service line: copies the
// supplier, amount, currency, terms and hold expiry onto the line, marks the line
// priced, and rejects competing offers for the same line — replacing the old
// "Log response" then "Accepted" then manually-retype-the-cost workflow (section 8).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canWrite(session.role, "serviceLines")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const reqId = Number((await ctx.params).id);
  if (!reqId) return NextResponse.json({ error: "Invalid request id" }, { status: 400 });

  const offer = await prisma.supplierQuoteRequest.findUnique({
    where: { id: reqId },
    include: { lead: true, serviceLine: true, supplier: { select: { id: true, companyName: true } } },
  });
  if (!offer) return NextResponse.json({ error: "Supplier request not found" }, { status: 404 });
  // Object-level auth: the offer's lead must belong to the acting agent.
  if (!canAccessRecord(session, offer.lead, "assignedToId")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!offer.serviceLineId) return NextResponse.json({ error: "This supplier request is not tied to a service line." }, { status: 409 });
  if (offer.price == null || offer.price <= 0) {
    return NextResponse.json({ error: "This supplier has not returned a usable price yet." }, { status: 409 });
  }

  const slId = offer.serviceLineId;
  try {
    await prisma.$transaction(async (tx) => {
      // Copy the winning offer onto the service line and mark it priced.
      await tx.serviceLine.update({
        where: { id: slId },
        data: {
          supplierId: offer.supplierId,
          supplierCost: offer.price,
          currency: offer.currency || offer.serviceLine?.currency || "USD",
          status: "Quoted",
        },
      });
      // This offer wins; competing pending offers on the same line are rejected.
      await tx.supplierQuoteRequest.update({ where: { id: reqId }, data: { outcome: "Accepted" } });
      await tx.supplierQuoteRequest.updateMany({
        where: { serviceLineId: slId, id: { not: reqId }, outcome: "Pending" },
        data: { outcome: "Rejected" },
      });
      // Activity trail on the lead.
      await tx.communication.create({
        data: {
          channel: "Supplier", direction: "Inbound", party: "supplier",
          summary: `Selected ${offer.supplier.companyName}'s offer (${offer.currency || "USD"} ${offer.price}) for service line #${slId}.`,
          leadId: offer.leadId, userId: session.id,
        },
      });
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Selecting offer failed" }, { status: 400 });
  }

  await logActivity({ userId: session.id, action: "use_offer", entityType: "serviceLines", entityId: slId, newValue: `${offer.supplier.companyName} ${offer.currency || "USD"} ${offer.price}`, ip: getIp(req) });
  return NextResponse.json({ ok: true, serviceLineId: slId, supplierId: offer.supplierId, price: offer.price, currency: offer.currency });
}
