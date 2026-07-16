import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canWrite } from "@/lib/auth";
import { createPaymentLink } from "@/lib/integrations/stripe";

export const dynamic = "force-dynamic";

// POST { bookingId } — create a Stripe payment link for a booking's outstanding
// customer balance and record a Pending payment row.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canWrite(session.role, "payments")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const { bookingId } = await req.json();
  const booking = await prisma.booking.findUnique({ where: { id: Number(bookingId) }, include: { lead: true } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const outstanding = (booking.customerInvoiceAmount || 0) - (booking.customerPaidAmount || 0);
  if (outstanding <= 0) return NextResponse.json({ error: "Nothing outstanding on this booking" }, { status: 400 });

  const link = await createPaymentLink({
    amount: outstanding,
    currency: booking.customerCurrency || "usd",
    description: `Booking ${booking.bookingRef || booking.id} — ${booking.lead?.customerName || "customer"}`,
    reference: booking.bookingRef || String(booking.id),
  });

  // Do NOT record a Pending payment when link creation actually failed (P0-08) —
  // a broken link must not look like a usable, in-progress payment.
  if (link.error) {
    return NextResponse.json({ error: "Could not create Stripe payment link. Check the Stripe configuration and try again." }, { status: 502 });
  }

  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      party: "customer",
      direction: "in",
      amount: outstanding,
      currency: booking.customerCurrency || "USD",
      method: "Stripe payment link",
      stripeLinkUrl: link.url,
      reference: link.id,
      status: "Pending",
      recordedById: session.id,
    },
  });

  return NextResponse.json({ url: link.url, stub: link.stub, paymentId: payment.id });
}
