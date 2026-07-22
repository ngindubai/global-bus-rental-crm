import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, logActivity, getIp } from "@/lib/auth";
import { convert, baseCurrency, getRate } from "@/lib/currency";
import { recomputeBookingPaid } from "@/lib/payments";
import { parseBody, z, isoCurrency, positiveAmount, optionalNote } from "@/lib/validation";

export const dynamic = "force-dynamic";

const FINANCE = ["FINANCE", "MANAGER", "ADMIN"];

// POST /api/payments/supplier-payment — finance-only supplier payout (business rule 4).
// Appends an immutable `supplier_payment` ledger row.
const Body = z.object({
  bookingId: z.coerce.number().int().positive(),
  supplierId: z.coerce.number().int().positive().optional().nullable(),
  amount: positiveAmount,
  currency: isoCurrency.optional(),
  method: z.string().trim().min(1).max(60).default("Bank transfer"),
  paidAt: z.coerce.date().optional(),
  reference: z.string().trim().max(200).optional().nullable(),
  notes: optionalNote,
  idempotencyKey: z.string().trim().min(8).max(200).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!FINANCE.includes(session.role)) return NextResponse.json({ error: "Only finance can record supplier payments." }, { status: 403 });

  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  if (body.idempotencyKey) {
    const dup = await prisma.payment.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
    if (dup) return NextResponse.json({ ok: true, existing: true, paymentId: dup.id });
  }

  const booking = await prisma.booking.findUnique({ where: { id: body.bookingId } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const currency = (body.currency || booking.supplierCurrency || baseCurrency()).toUpperCase();
  const supplierCurrency = (booking.supplierCurrency || baseCurrency()).toUpperCase();
  const rateToReporting = await getRate(currency, baseCurrency());
  if (!isFinite(rateToReporting)) {
    return NextResponse.json({ error: `No exchange rate for ${currency} → ${baseCurrency()}.` }, { status: 422 });
  }
  const amountInBooking = await convert(body.amount, currency, supplierCurrency);
  const reportingAmount = await convert(body.amount, currency, baseCurrency());

  let rolled: any;
  try {
    rolled = await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          bookingId: booking.id,
          party: "supplier",
          direction: "out",
          kind: "supplier_payment",
          supplierId: body.supplierId ?? booking.supplierId ?? null,
          amount: body.amount,
          currency,
          baseAmount: isFinite(amountInBooking) ? amountInBooking : null,
          reportingAmount: isFinite(reportingAmount) ? reportingAmount : null,
          reportingCurrency: baseCurrency(),
          exchangeRate: rateToReporting,
          fxSource: "api",
          method: body.method,
          reference: body.reference ?? null,
          notes: body.notes ?? null,
          status: "Paid",
          paidAt: body.paidAt || new Date(),
          idempotencyKey: body.idempotencyKey ?? null,
          recordedById: session.id,
        },
      });
      return recomputeBookingPaid(tx, booking.id);
    });
  } catch (e: any) {
    if (e?.code === "P2002" && body.idempotencyKey) {
      const dup = await prisma.payment.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
      if (dup) return NextResponse.json({ ok: true, existing: true, paymentId: dup.id });
    }
    return NextResponse.json({ error: e.message || "Recording supplier payment failed" }, { status: 400 });
  }

  await logActivity({ userId: session.id, action: "supplier_payment", entityType: "bookings", entityId: booking.id, newValue: `supplier ${currency} ${body.amount}`, ip: getIp(req) });
  return NextResponse.json({ ok: true, ...(rolled || {}) });
}
