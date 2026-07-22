import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canWrite, canAccessRecord, logActivity, getIp } from "@/lib/auth";
import { parseBody, z, optionalNote } from "@/lib/validation";

export const dynamic = "force-dynamic";

// POST /api/bookings/:id/complete — record a completion outcome (section 16).
// Outcomes: completed | no_show | cancelled | incident. Moves the booking to
// COMPLETED (or CANCELLED for a cancellation). Financial closure still requires
// finance reconciliation afterwards.
const Body = z.object({
  outcome: z.enum(["completed", "no_show", "cancelled", "incident"]).default("completed"),
  notes: optionalNote,
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canWrite(session.role, "bookings")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const id = Number((await ctx.params).id);
  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.res;
  const { outcome, notes } = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (!canAccessRecord(session, booking, "agentId")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (["COMPLETED", "CANCELLED"].includes(booking.operationalStage)) {
    return NextResponse.json({ error: `Booking is already ${booking.operationalStage}.` }, { status: 409 });
  }
  if (booking.operationalStage === "PROVISIONAL" && outcome === "completed") {
    return NextResponse.json({ error: "A provisional (unconfirmed) booking cannot be marked completed." }, { status: 409 });
  }

  const stage = outcome === "cancelled" ? "CANCELLED" : "COMPLETED";
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id },
      data: {
        operationalStage: stage,
        completionOutcome: outcome,
        completedAt: outcome === "cancelled" ? null : new Date(),
        cancelledAt: outcome === "cancelled" ? new Date() : null,
        status: stage === "CANCELLED" ? "Cancelled" : "Travel Completed",
        version: { increment: 1 },
      },
    });
    await tx.businessEvent.create({ data: { type: outcome === "cancelled" ? "cancelled" : "completed", bookingId: id, userId: session.id, data: JSON.stringify({ outcome, notes: notes || null }) } });
  });

  await logActivity({ userId: session.id, action: "complete", entityType: "bookings", entityId: id, newValue: outcome, ip: getIp(req) });
  return NextResponse.json({ ok: true, operationalStage: stage, outcome });
}
