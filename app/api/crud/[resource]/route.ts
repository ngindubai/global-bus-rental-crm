import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canWrite, logActivity, getIp, notify } from "@/lib/auth";
import { RESOURCES, coerceBody, makeRef } from "@/lib/registry";
import { pickOwner, slaDueAt } from "@/lib/assign";
import { profitAndMargin } from "@/lib/currency";

export const dynamic = "force-dynamic";

// GET /api/crud/:resource — list with search/filter/pagination
export async function GET(req: NextRequest, { params }: { params: { resource: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const def = RESOURCES[params.resource];
  if (!def) return NextResponse.json({ error: "Unknown resource" }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const where: any = {};
  if (def.softDelete) where.deletedAt = null;

  for (const [key, value] of sp.entries()) {
    if (key.startsWith("f_") && value !== "") {
      const field = key.slice(2);
      const num = Number(value);
      where[field] = !isNaN(num) && /Id$/.test(field) ? num : value;
    }
  }

  const search = sp.get("search");
  if (search && def.search?.length) {
    where.OR = def.search.map((f) => ({ [f]: { contains: search, mode: "insensitive" } }));
  }

  // agents only see their own leads/bookings
  if (session.role === "AGENT" && def.ownerScope) {
    where[def.ownerScope] = session.id;
  }

  const from = sp.get("from");
  const to = sp.get("to");
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to + "T23:59:59");
  }

  const take = Math.min(Number(sp.get("take") || 200), 500);
  const skip = Number(sp.get("skip") || 0);

  const model = (prisma as any)[def.model];
  const [items, total] = await Promise.all([
    model.findMany({ where, include: def.include, orderBy: def.defaultOrder, take, skip }),
    model.count({ where }),
  ]);

  // never leak password hashes through the generic list (used for ref dropdowns)
  if (params.resource === "users") items.forEach((u: any) => delete u.passwordHash);

  return NextResponse.json({ items, total });
}

// POST /api/crud/:resource — create
export async function POST(req: NextRequest, { params }: { params: { resource: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const def = RESOURCES[params.resource];
  if (!def) return NextResponse.json({ error: "Unknown resource" }, { status: 404 });
  if (!canWrite(session.role, params.resource)) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const raw = await req.json();
  const data = coerceBody(raw);
  delete data.id;

  const model = (prisma as any)[def.model];

  // duplicate lead detection by phone/email
  if (params.resource === "leads" && !raw._force) {
    const dupWhere: any[] = [];
    if (data.phone) dupWhere.push({ phone: data.phone });
    if (data.email) dupWhere.push({ email: data.email });
    if (data.whatsapp) dupWhere.push({ whatsapp: data.whatsapp });
    if (dupWhere.length) {
      const dup = await model.findFirst({ where: { OR: dupWhere, deletedAt: null } });
      if (dup) {
        return NextResponse.json(
          {
            error: `Possible duplicate of lead ${dup.leadRef || dup.id} (${dup.customerName}). Submit again to create anyway.`,
            duplicateId: dup.id,
            duplicate: true,
          },
          { status: 409 }
        );
      }
    }
  }
  delete data._force;

  // ── lead automations: assignment + SLA ──
  if (params.resource === "leads") {
    if (!data.assignedToId) {
      data.assignedToId = await pickOwner({ countryId: data.countryId, brandId: data.brandId, source: data.source });
    }
    if (data.assignedToId) {
      data.assignedAt = new Date();
      data.status = data.status && data.status !== "New Lead" ? data.status : "Assigned";
    }
    data.slaDueAt = slaDueAt(data.priority);
  }

  // stamp acting user
  if (params.resource === "tasks") {
    if (!data.assignedToId) data.assignedToId = session.id;
    data.createdById = session.id;
  }
  if (params.resource === "notes" || params.resource === "communications") data.userId = session.id;
  if (params.resource === "communications" && !data.occurredAt) data.occurredAt = new Date();
  if (params.resource === "quotes") data.createdById = session.id;
  if (params.resource === "supplierRequests") data.requestedById = session.id;
  if (params.resource === "payments") data.recordedById = session.id;

  // derive money fields
  if (params.resource === "serviceLines" || params.resource === "quotes") {
    const { profit, margin } = profitAndMargin(Number(data.supplierCost || 0), Number(data.customerPrice || 0));
    data.profit = profit;
    data.margin = margin;
  }

  let created;
  try {
    created = await model.create({ data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Create failed" }, { status: 400 });
  }

  // auto reference numbers
  if (def.refPrefix && def.refField && !created[def.refField]) {
    created = await model.update({
      where: { id: created.id },
      data: { [def.refField]: makeRef(def.refPrefix, created.id) },
    });
  }

  await logActivity({
    userId: session.id,
    action: "create",
    entityType: params.resource,
    entityId: created.id,
    newValue: JSON.stringify(data).slice(0, 500),
    ip: getIp(req),
  });

  // notifications + side effects
  if (params.resource === "leads") {
    await prisma.leadStatusHistory.create({
      data: { leadId: created.id, fromStatus: null, toStatus: created.status, userId: session.id },
    });
    if (created.assignedToId) {
      await prisma.task.create({
        data: {
          title: `First contact: ${created.customerName}`,
          taskType: "Call customer",
          leadId: created.id,
          assignedToId: created.assignedToId,
          createdById: session.id,
          dueDate: created.slaDueAt || new Date(Date.now() + 60 * 60 * 1000),
          priority: created.priority === "Low" ? "Medium" : "High",
        },
      });
      await notify(created.assignedToId, "New lead assigned", `${created.customerName} (${created.source})`, `/leads/${created.id}`);
    }
  }

  if (params.resource === "communications" && created.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: created.leadId } });
    const patch: any = { lastContactAt: new Date() };
    // first response stops the SLA timer
    if (lead && !lead.firstResponseAt && created.direction === "Outbound") {
      patch.firstResponseAt = new Date();
    }
    await prisma.lead.update({ where: { id: created.leadId }, data: patch }).catch(() => {});
  }

  if (params.resource === "tasks" && created.assignedToId && created.assignedToId !== session.id) {
    await notify(created.assignedToId, "New task assigned", created.title, `/tasks`);
  }

  return NextResponse.json({ item: created }, { status: 201 });
}
