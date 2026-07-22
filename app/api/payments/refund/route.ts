import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, logActivity, getIp } from "@/lib/auth";
import { recomputeBookingPaid } from "@/lib/payments";
import { parseBody, z, isoCurrency, positiveAmount } from "@/lib/validation";

export const dynamic = "force-dynamic";

const FINANCE = ["FINANCE", "MANAGER", "ADMIN"];

// POST /api/payments/refund — finance-only. Appends an immutable `refund` row
// (money out to the customer) with a mandatory reason. Never edits prior rows.
const Body = z.object({
  bookingId: z.coerce.number().int().positive(),
  amount: positiveAmount,
  currency: isoCurrency.optional(),
  method: z.string().trim().min(1).max(60).default("Bank transfer"),
  reason: z.string().trim().min(3, "A reason is required").max(500),
  reference: z.string().trim().max(200).optional().nullable(),
  refundOfId: z.coerce.number().int().positive().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!FINANCE.includes(session.role)) return NextResponse.json({ error: "Only finance can record refunds." }, { status: 403 });

  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: body.bookingId } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const currency = (body.currency || booking.customerCurrency || "USD").toUpperCase();

  let rolled: any;
  try {
    rolled = await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          bookingId: booking.id,
          party: "customer",
          direction: "out",
          kind: "refund",
          amount: body.amount,
          currency,
          method: body.method,
          reference: body.reference ?? null,
          reason: body.reason,
          reversalOfId: body.refundOfId ?? null,
          status: "Paid",
          paidAt: new Date(),
          recordedById: session.id,
        },
      });
      await tx.businessEvent.create({ data: { type: "refunded", bookingId: booking.id, userId: session.id, data: JSON.stringify({ amount: body.amount, currency, reason: body.reason }) } });
      return recomputeBookingPaid(tx, booking.id);
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Refund failed" }, { status: 400 });
  }

  await logActivity({ userId: session.id, action: "refund", entityType: "bookings", entityId: booking.id, newValue: `${currency} ${body.amount}: ${body.reason}`, ip: getIp(req) });
  return NextResponse.json({ ok: true, ...(rolled || {}) });
}
