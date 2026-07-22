import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canWrite, canAccessRecord, logActivity, getIp, notify } from "@/lib/auth";
import { RESOURCES, coerceBody, filterWritable, GENERIC_WRITE_BLOCKED } from "@/lib/registry";
import { profitAndMargin } from "@/lib/currency";

export const dynamic = "force-dynamic";

function ctx(params: { resource: string; id: string }) {
  const def = RESOURCES[params.resource];
  const id = Number(params.id);
  return { def, id };
}

export async function GET(req: NextRequest, context: { params: Promise<{ resource: string; id: string }> }) {
  const params = await context.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { def, id } = ctx(params);
  if (!def || isNaN(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const item = await (prisma as any)[def.model].findUnique({ where: { id }, include: def.include });
  if (!item || (def.softDelete && item.deletedAt)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // object-level authorisation: agents may only read their own scoped records
  if (!canAccessRecord(session, item, def.ownerScope)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (params.resource === "users") delete (item as any).passwordHash;
  return NextResponse.json({ item });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ resource: string; id: string }> }) {
  const params = await context.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { def, id } = ctx(params);
  if (!def || isNaN(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canWrite(session.role, params.resource)) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  if (GENERIC_WRITE_BLOCKED.has(params.resource)) {
    return NextResponse.json(
      { error: "This resource cannot be modified through the generic API. Use its dedicated endpoint." },
      { status: 403 }
    );
  }

  const model = (prisma as any)[def.model];
  const existing = await model.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // object-level authorisation: agents may only mutate their own scoped records
  if (!canAccessRecord(session, existing, def.ownerScope)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const raw = await req.json();
  const data = filterWritable(params.resource, coerceBody(raw), session.role);
  delete data.id;
  delete data.createdAt;
  delete data.updatedAt;

  // recompute profit/margin when money fields change
  if (params.resource === "serviceLines" || params.resource === "quotes") {
    const sc = data.supplierCost ?? existing.supplierCost ?? 0;
    const cp = data.customerPrice ?? existing.customerPrice ?? 0;
    const { profit, margin } = profitAndMargin(Number(sc), Number(cp));
    data.profit = profit;
    data.margin = margin;
  }

  let updated;
  try {
    updated = await model.update({ where: { id }, data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Update failed" }, { status: 400 });
  }

  // field-level audit trail
  const ip = getIp(req);
  for (const key of Object.keys(data)) {
    const oldV = existing[key];
    const newV = (updated as any)[key];
    if (String(oldV ?? "") !== String(newV ?? "")) {
      await logActivity({
        userId: session.id,
        action:
          key === "status"
            ? "status_change"
            : key.endsWith("Id") && key.toLowerCase().includes("assign")
            ? "assign"
            : "update",
        entityType: params.resource,
        entityId: id,
        field: key,
        oldValue: oldV,
        newValue: newV,
        ip,
      });
    }
  }

  // ── lead status / assignment automations ──
  if (params.resource === "leads" && data.status && data.status !== existing.status) {
    await prisma.leadStatusHistory.create({
      data: { leadId: id, fromStatus: existing.status, toStatus: data.status, userId: session.id },
    });
    await prisma.lead.update({ where: { id }, data: { lastContactAt: new Date() } });
  }
  if (params.resource === "leads" && data.assignedToId && data.assignedToId !== existing.assignedToId) {
    await prisma.lead.update({ where: { id }, data: { assignedAt: new Date() } });
    await notify(data.assignedToId, "Lead assigned to you", updated.customerName, `/leads/${id}`);
  }

  // ── supplier quote response → recompute response time + score ──
  if (params.resource === "supplierRequests" && data.respondedAt && !existing.respondedAt) {
    const mins = Math.max(0, Math.round((new Date(updated.respondedAt).getTime() - new Date(existing.sentAt).getTime()) / 60000));
    await prisma.supplierQuoteRequest.update({ where: { id }, data: { responseMins: mins } });
    const { recomputeSupplierScore } = await import("@/lib/scoring");
    await recomputeSupplierScore(existing.supplierId);
  }

  // ── booking status → notify finance/management ──
  // NOTE: payment amounts are NEVER derived from a status change. "Customer Paid"
  // is a computed reflection of the immutable payment ledger (see
  // /api/payments/record and the Stripe webhook), so a manual status flip can no
  // longer conjure a payment that never happened (P0-04).
  if (params.resource === "bookings" && data.status && data.status !== existing.status) {
    const finance = await prisma.user.findMany({ where: { role: { in: ["FINANCE", "MANAGER"] }, active: true } });
    for (const f of finance) {
      await notify(f.id, `Booking ${updated.bookingRef || id}: ${data.status}`, updated.city || "", `/bookings/${id}`);
    }
  }

  if (params.resource === "tasks" && data.status === "Completed" && existing.status !== "Completed") {
    await model.update({ where: { id }, data: { completedAt: new Date() } });
  }

  // commission approval/paid stamps
  if (params.resource === "commissions") {
    if (data.status === "approved" && existing.status !== "approved") {
      await prisma.commission.update({ where: { id }, data: { approvedById: session.id } });
    }
    if (data.status === "paid" && existing.status !== "paid") {
      await prisma.commission.update({ where: { id }, data: { paidDate: new Date() } });
      if (updated.agentId) await notify(updated.agentId, "Commission paid", `${updated.currency || ""} ${updated.amount}`, `/commissions`);
    }
  }

  return NextResponse.json({ item: updated });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ resource: string; id: string }> }) {
  const params = await context.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { def, id } = ctx(params);
  if (!def || isNaN(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!["ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Only admins/managers can delete records" }, { status: 403 });
  }

  const model = (prisma as any)[def.model];
  try {
    if (def.softDelete) {
      await model.update({ where: { id }, data: { deletedAt: new Date() } });
    } else {
      await model.delete({ where: { id } });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Delete failed" }, { status: 400 });
  }

  await logActivity({ userId: session.id, action: "delete", entityType: params.resource, entityId: id, ip: getIp(req) });
  return NextResponse.json({ ok: true });
}
