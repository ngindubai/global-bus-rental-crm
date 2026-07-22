import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, logActivity, getIp } from "@/lib/auth";
import { parseBody, z } from "@/lib/validation";

export const dynamic = "force-dynamic";

const FINANCE = ["FINANCE", "MANAGER", "ADMIN"];

// POST /api/payments/:id/reconcile — finance-only. Marks an Unreconciled customer
// receipt as matched (or unmatches it where policy permits). This does NOT edit the
// money row's amounts — it only stamps who reconciled it and when.
const Body = z.object({
  action: z.enum(["reconcile", "unreconcile"]).default("reconcile"),
  reference: z.string().trim().max(200).optional().nullable(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!FINANCE.includes(session.role)) return NextResponse.json({ error: "Only finance can reconcile payments." }, { status: 403 });

  const paymentId = Number((await ctx.params).id);
  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.res;
  const { action, reference } = parsed.data;

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

  const data: any =
    action === "reconcile"
      ? { reconciledAt: new Date(), reconciledById: session.id, reference: reference ?? payment.reference ?? null }
      : { reconciledAt: null, reconciledById: null };
  const updated = await prisma.payment.update({ where: { id: paymentId }, data });

  await logActivity({ userId: session.id, action: String(action), entityType: "payments", entityId: paymentId, ip: getIp(req) });

  // Financial closure: if every non-reversed customer receipt on the booking is now
  // reconciled and the booking is complete, the booking may close (RECONCILED).
  if (action === "reconcile") {
    const booking = await prisma.booking.findUnique({ where: { id: payment.bookingId } });
    if (booking && ["COMPLETED", "CONFIRMED", "IN_SERVICE"].includes(booking.operationalStage)) {
      const outstanding = await prisma.payment.count({
        where: { bookingId: booking.id, party: "customer", status: "Paid", kind: { not: "reversal" }, reconciledAt: null },
      });
      if (outstanding === 0 && booking.operationalStage === "COMPLETED" && booking.financialClosure !== "RECONCILED") {
        await prisma.booking.update({ where: { id: booking.id }, data: { financialClosure: "RECONCILED", version: { increment: 1 } } });
        await prisma.businessEvent.create({ data: { type: "reconciled", bookingId: booking.id, userId: session.id } });
      }
    }
  }

  return NextResponse.json({ ok: true, reconciledAt: updated.reconciledAt });
}
