import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canWrite, canAccessRecord, logActivity, getIp } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST — broadcast a quote request to multiple suppliers for a lead (Module 7).
// body: { supplierIds: number[], serviceLineId?: number, method: string, notes?: string }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canWrite(session.role, "supplierRequests")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const leadId = Number((await params).id);
  const { supplierIds, serviceLineId, method, notes } = await req.json();
  if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
    return NextResponse.json({ error: "Select at least one supplier" }, { status: 400 });
  }

  // object-level authorisation (P0-02): only the lead's owner (or a manager) may
  // broadcast supplier requests for it.
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { assignedToId: true, deletedAt: true } });
  if (!lead || lead.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canAccessRecord(session, lead, "assignedToId")) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const created = await prisma.$transaction(
    supplierIds.map((sid: number) =>
      prisma.supplierQuoteRequest.create({
        data: {
          leadId,
          serviceLineId: serviceLineId ? Number(serviceLineId) : null,
          supplierId: Number(sid),
          method: method || "email",
          requestedById: session.id,
          notes: notes || null,
        },
      })
    )
  );

  // advance the lead pipeline + log each supplier comm
  await prisma.lead.update({ where: { id: leadId }, data: { status: "Supplier Quotes Requested" } }).catch(() => {});
  await prisma.leadStatusHistory.create({ data: { leadId, toStatus: "Supplier Quotes Requested", userId: session.id } }).catch(() => {});
  for (const sid of supplierIds) {
    const sup = await prisma.supplier.findUnique({ where: { id: Number(sid) }, select: { companyName: true } });
    await prisma.communication.create({
      data: {
        channel: "Supplier",
        direction: "Outbound",
        party: "supplier",
        summary: `Quote request sent to ${sup?.companyName || "supplier"} via ${method || "email"}`,
        leadId,
        userId: session.id,
      },
    });
  }
  await logActivity({ userId: session.id, action: "broadcast", entityType: "leads", entityId: leadId, newValue: `${supplierIds.length} suppliers`, ip: getIp(req) });

  return NextResponse.json({ ok: true, count: created.length });
}
