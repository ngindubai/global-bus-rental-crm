import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, logActivity, getIp } from "@/lib/auth";
import { recomputeBookingPaid } from "@/lib/payments";
import { parseBody, z } from "@/lib/validation";

export const dynamic = "force-dynamic";

const FINANCE = ["FINANCE", "MANAGER", "ADMIN"];

// POST /api/payments/:id/reverse — finance-only. Posted ledger rows are immutable:
// a mistake is corrected by APPENDING a reversal (or correction) row that references
// the original, with a mandatory reason. The original row is never edited or deleted.
const Body = z.object({
  reason: z.string().trim().min(3, "A reason is required").max(500),
  kind: z.enum(["reversal", "correction"]).default("reversal"),
  // For a correction, the replacement amount (a fresh row is appended after the reversal).
  correctedAmount: z.union([z.number(), z.string()]).optional().nullable(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!FINANCE.includes(session.role)) return NextResponse.json({ error: "Only finance can reverse or correct ledger entries." }, { status: 403 });

  const paymentId = Number((await ctx.params).id);
  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.res;
  const { reason, kind } = parsed.data;

  const original = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!original) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  if (original.status === "Reversed") return NextResponse.json({ error: "This payment has already been reversed." }, { status: 409 });
  // Guard against reversing a reversal.
  if (original.kind === "reversal") return NextResponse.json({ error: "Cannot reverse a reversal row." }, { status: 409 });

  let rolled: any;
  try {
    rolled = await prisma.$transaction(async (tx) => {
      // Re-read under the transaction and block a double reversal.
      const existingReversal = await tx.payment.findFirst({ where: { reversalOfId: paymentId, kind: "reversal" } });
      if (existingReversal) throw Object.assign(new Error("Already reversed"), { code: "ALREADY" });

      // Append the reversal row (recomputeBookingPaid subtracts kind=reversal).
      await tx.payment.create({
        data: {
          bookingId: original.bookingId,
          party: original.party,
          direction: original.direction === "in" ? "out" : "in",
          kind: "reversal",
          supplierId: original.supplierId,
          amount: original.amount,
          currency: original.currency,
          baseAmount: original.baseAmount,
          reportingAmount: original.reportingAmount,
          reportingCurrency: original.reportingCurrency,
          exchangeRate: original.exchangeRate,
          fxSource: original.fxSource,
          method: original.method,
          reference: original.reference,
          reason,
          reversalOfId: original.id,
          status: "Paid",
          paidAt: new Date(),
          recordedById: session.id,
        },
      });
      // Mark the ORIGINAL as reversed for display only — its amounts are untouched,
      // so history is preserved; the net effect comes from the appended row.
      await tx.payment.update({ where: { id: paymentId }, data: { status: "Reversed" } });
      await tx.businessEvent.create({ data: { type: "reversed", bookingId: original.bookingId, userId: session.id, data: JSON.stringify({ paymentId, kind, reason }) } });
      return recomputeBookingPaid(tx, original.bookingId);
    });
  } catch (e: any) {
    if (e?.code === "ALREADY") return NextResponse.json({ error: "This payment has already been reversed." }, { status: 409 });
    return NextResponse.json({ error: e.message || "Reversal failed" }, { status: 400 });
  }

  await logActivity({ userId: session.id, action: "reverse", entityType: "payments", entityId: paymentId, newValue: reason, ip: getIp(req) });
  return NextResponse.json({ ok: true, ...(rolled || {}) });
}
