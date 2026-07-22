import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canAccessRecord } from "@/lib/auth";
import { computePaymentState, computeReadiness } from "@/lib/policy";

export const dynamic = "force-dynamic";

// GET /api/bookings/:id — the booking workspace payload. Returns the booking with
// its legs, ledger, plan, tasks and history PLUS the server-computed readiness,
// customer/supplier payment state and the single contextual "next action". The UI
// renders these facts; it never chooses a status from a dropdown.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const id = Number((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      lead: { select: { id: true, customerName: true, customerId: true } },
      brand: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true } },
      supplier: { select: { id: true, companyName: true } },
      legs: { include: { supplier: { select: { id: true, companyName: true } }, supplierAcceptances: { orderBy: { createdAt: "desc" } } }, orderBy: { legIndex: "asc" } },
      payments: { orderBy: { createdAt: "desc" }, include: { recordedBy: { select: { name: true } }, reconciledBy: { select: { name: true } } } },
      paymentPlan: { include: { milestones: { orderBy: { sortOrder: "asc" } } } },
      events: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!booking || booking.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Object-level authorisation: an agent may only open their own booking.
  if (!canAccessRecord(session, booking, "agentId")) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const openRevisions = await prisma.bookingRevision.count({ where: { bookingId: id, status: "proposed" } });
  const tasks = await prisma.task.findMany({ where: { leadId: booking.leadId ?? -1, deletedAt: null }, orderBy: { dueDate: "asc" }, take: 30 });

  const paymentState = await computePaymentState(prisma, booking);
  const readiness = computeReadiness({ ...booking, _openRevisions: openRevisions > 0 }, booking.legs, paymentState);

  // Supplier balance = agreed leg cost − supplier payments made (booking currency).
  const supplierCost = Number(booking.supplierCost || 0);
  const supplierPaid = Number(booking.supplierPaidAmount || 0);

  const nextAction = computeNextAction(booking, paymentState, readiness, session.role);

  return NextResponse.json({
    booking: {
      ...booking,
      customerBalance: Math.round((paymentState.total - paymentState.paid) * 100) / 100,
      supplierBalance: Math.round((supplierCost - supplierPaid) * 100) / 100,
    },
    paymentState,
    readiness,
    nextAction,
    tasks,
    openRevisions,
  });
}

function computeNextAction(booking: any, ps: any, readiness: any, role: string) {
  if (booking.operationalStage === "CANCELLED") return null;
  const firstUnaccepted = booking.legs.find((l: any) => !l.cancelledAt && l.supplierConfirmation !== "ACCEPTED");
  if (firstUnaccepted) {
    return { kind: "record_supplier_acceptance", label: `Record supplier acceptance (Leg ${firstUnaccepted.legIndex})`, legId: firstUnaccepted.id };
  }
  if (!ps.confirmationSatisfied || ps.requiredNow > 0) {
    return { kind: "record_receipt", label: `Record customer receipt (${ps.requiredNow > 0 ? ps.requiredNow.toFixed(2) : ps.confirmationRequired.toFixed(2)} due)` };
  }
  if (booking.operationalStage === "CONFIRMED" && readiness.readiness !== "READY") {
    return { kind: "resolve_blockers", label: "Resolve readiness blockers" };
  }
  if (booking.operationalStage === "CONFIRMED" && booking.travelDate && new Date(booking.travelDate) < new Date()) {
    return { kind: "complete", label: "Record completion" };
  }
  if (booking.operationalStage === "COMPLETED" && booking.financialClosure === "OPEN") {
    return ["FINANCE", "MANAGER", "ADMIN"].includes(role)
      ? { kind: "reconcile", label: "Reconcile & close" }
      : { kind: "await_finance", label: "Awaiting finance reconciliation" };
  }
  return { kind: "none", label: "Up to date" };
}
