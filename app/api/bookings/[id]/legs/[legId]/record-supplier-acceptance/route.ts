import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canWrite, canAccessRecord, logActivity, getIp, notify } from "@/lib/auth";
import { evaluateConfirmation } from "@/lib/policy";
import { parseBody, z, isoCurrency, positiveAmount, optionalNote } from "@/lib/validation";

export const dynamic = "force-dynamic";

// POST /api/bookings/:id/legs/:legId/record-supplier-acceptance
// Records a MANUAL supplier commitment to a specific leg (business rule 6). This is
// deliberately distinct from a supplier merely quoting a price/availability — it is
// the supplier committing to the customer-accepted booking. Once every required leg
// is supplier-accepted (and the payment condition is met) the booking auto-confirms.
const Body = z.object({
  supplierId: z.coerce.number().int().positive(),
  acceptingContact: z.string().trim().max(200).optional().nullable(),
  channel: z.enum(["phone", "whatsapp", "email", "other"]).default("phone"),
  agreedAmount: positiveAmount,
  agreedCurrency: isoCurrency,
  agreedTerms: z.string().trim().max(1000).optional().nullable(),
  acceptedAt: z.coerce.date().optional(),
  holdExpiresAt: z.coerce.date().optional().nullable(),
  supplierRequestId: z.coerce.number().int().positive().optional().nullable(),
  notes: optionalNote,
  evidenceRef: z.string().trim().max(500).optional().nullable(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; legId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canWrite(session.role, "bookings")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const { id, legId } = await ctx.params;
  const bookingId = Number(id);
  const legIdNum = Number(legId);

  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  // The sales agent owns the booking end-to-end (business rule 1) — object-level auth.
  if (!canAccessRecord(session, booking, "agentId")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (booking.operationalStage === "CANCELLED") return NextResponse.json({ error: "Booking is cancelled." }, { status: 409 });

  const leg = await prisma.bookingLeg.findUnique({ where: { id: legIdNum } });
  if (!leg || leg.bookingId !== bookingId) return NextResponse.json({ error: "Leg not found on this booking" }, { status: 404 });
  if (leg.cancelledAt) return NextResponse.json({ error: "This leg is cancelled." }, { status: 409 });

  const supplier = await prisma.supplier.findUnique({ where: { id: b.supplierId } });
  if (!supplier) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });

  let confirmation;
  try {
    confirmation = await prisma.$transaction(async (tx) => {
      await tx.supplierAcceptance.create({
        data: {
          bookingLegId: legIdNum,
          supplierId: b.supplierId,
          supplierRequestId: b.supplierRequestId ?? null,
          acceptingContact: b.acceptingContact ?? null,
          recordedById: session.id,
          acceptedAt: b.acceptedAt || new Date(),
          channel: b.channel,
          agreedAmount: b.agreedAmount,
          agreedCurrency: b.agreedCurrency,
          agreedTerms: b.agreedTerms ?? null,
          holdExpiresAt: b.holdExpiresAt ?? null,
          notes: b.notes ?? null,
          evidenceRef: b.evidenceRef ?? null,
        },
      });
      // Mark the leg supplier-accepted and pin the committed supplier/amount.
      await tx.bookingLeg.update({
        where: { id: legIdNum },
        data: {
          supplierId: b.supplierId,
          supplierConfirmation: "ACCEPTED",
          supplierAmount: b.agreedAmount,
          supplierCurrency: b.agreedCurrency,
        },
      });
      // Close the accepted supplier request/offer if one was referenced.
      if (b.supplierRequestId) {
        await tx.supplierQuoteRequest.update({ where: { id: b.supplierRequestId }, data: { outcome: "Accepted" } }).catch(() => {});
      }
      await tx.businessEvent.create({
        data: { type: "supplier_accepted", bookingId, userId: session.id, data: JSON.stringify({ legId: legIdNum, supplierId: b.supplierId, agreedAmount: b.agreedAmount, agreedCurrency: b.agreedCurrency, channel: b.channel }) },
      });
      // May now satisfy the confirmation policy.
      return evaluateConfirmation(tx, bookingId, session.id);
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Recording supplier acceptance failed" }, { status: 400 });
  }

  await logActivity({ userId: session.id, action: "supplier_acceptance", entityType: "bookings", entityId: bookingId, newValue: `leg ${legIdNum} • ${supplier.companyName} • ${b.agreedCurrency} ${b.agreedAmount}`, ip: getIp(req) });
  if (confirmation?.changed) {
    const finance = await prisma.user.findMany({ where: { role: { in: ["FINANCE", "MANAGER"] }, active: true } });
    for (const f of finance) await notify(f.id, "Booking confirmed", `${booking.bookingRef || bookingId} • ${confirmation.reason}`, `/bookings/${bookingId}`);
  }

  return NextResponse.json({ ok: true, confirmed: confirmation?.changed || false, reason: confirmation?.reason });
}
