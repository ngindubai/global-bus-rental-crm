import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyStripeSignature, stripeWebhookConfigured } from "@/lib/integrations/stripe";
import { recomputeBookingPaid } from "@/lib/payments";
import { convert, baseCurrency } from "@/lib/currency";
import { notify, logActivity } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Stripe posts payment events here (P0-08). A pending payment created by
// /api/payments/stripe-link is only marked Paid — and the booking totals only
// advance — when a *verified* Stripe event confirms completion. Handling is
// idempotent via the Stripe event id stored on the payment row, so duplicate
// webhook deliveries are safe.
export async function POST(req: NextRequest) {
  if (!stripeWebhookConfigured()) {
    return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 503 });
  }

  const raw = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!verifyStripeSignature(raw, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Idempotency: if we have already recorded this event, acknowledge and stop.
  if (event.id) {
    const seen = await prisma.payment.findFirst({ where: { providerEventId: event.id }, select: { id: true } });
    if (seen) return NextResponse.json({ received: true, duplicate: true });
  }

  const type = event.type as string;
  const obj = event.data?.object || {};

  // We reconcile completed checkout sessions created from our payment links.
  if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
    const paymentLinkId: string | null = obj.payment_link || null;
    const reference: string | null = obj.metadata?.reference || null;
    const paidStatus = obj.payment_status; // "paid" | "unpaid" | "no_payment_required"
    if (paidStatus && paidStatus !== "paid") {
      return NextResponse.json({ received: true, ignored: `payment_status=${paidStatus}` });
    }

    // Match the pending row: primarily by the payment-link id we stored as its
    // reference, falling back to the booking reference in metadata.
    const pending = await prisma.payment.findFirst({
      where: {
        status: "Pending",
        method: "Stripe payment link",
        OR: [
          ...(paymentLinkId ? [{ reference: paymentLinkId }] : []),
          ...(reference ? [{ booking: { bookingRef: reference } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    if (!pending) {
      // Nothing to reconcile (already handled, or link created elsewhere).
      return NextResponse.json({ received: true, matched: false });
    }

    const currency = (obj.currency || pending.currency || baseCurrency()).toUpperCase();
    // pending.amount is a Prisma Decimal; normalise to a JS number for arithmetic.
    const amount = typeof obj.amount_total === "number" ? obj.amount_total / 100 : Number(pending.amount);
    const baseAmount = await convert(amount, currency, baseCurrency());

    const result = await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: pending.id },
        data: {
          status: "Paid",
          amount,
          currency,
          baseAmount: isFinite(baseAmount) ? baseAmount : null,
          paidAt: new Date(),
          providerEventId: event.id || null,
          reference: obj.payment_intent || pending.reference,
          reconciledAt: null, // finance still reconciles verified receipts
        },
      });
      return recomputeBookingPaid(tx, pending.bookingId);
    });

    await logActivity({ action: "payment", entityType: "bookings", entityId: pending.bookingId, newValue: `stripe ${currency} ${amount}` });
    const booking = await prisma.booking.findUnique({ where: { id: pending.bookingId } });
    const finance = await prisma.user.findMany({ where: { role: { in: ["FINANCE", "MANAGER"] }, active: true } });
    for (const f of finance) await notify(f.id, "Stripe payment confirmed", `${booking?.bookingRef || pending.bookingId}: ${currency} ${amount}`, `/bookings/${pending.bookingId}`);

    return NextResponse.json({ received: true, matched: true, ...(result || {}) });
  }

  // Other event types are acknowledged but not acted upon.
  return NextResponse.json({ received: true, ignored: type });
}
