import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canWrite, canAccessRecord, logActivity, getIp, notify } from "@/lib/auth";
import { convert, baseCurrency } from "@/lib/currency";
import { recomputeBookingPaid } from "@/lib/payments";

export const dynamic = "force-dynamic";

// POST — record a manual payment (customer in / supplier out) and roll the
// booking's paid totals + status forward. body:
// { bookingId, party: 'customer'|'supplier', amount, currency, method, reference }
//
// Ledger rules (P0-04, P1-06, P1-07):
//   • amount must be a positive, finite number in a known currency;
//   • customer receipts are posted as `Unreconciled` (reconciledAt = null) until
//     finance matches them — sales agents may post receipts for their own bookings;
//   • supplier payouts are finance/manager/admin only;
//   • paid totals are recomputed from the immutable Paid rows, currency-converted
//     into the booking currency, inside one transaction so concurrent posts stay
//     consistent.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canWrite(session.role, "payments")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const body = await req.json();
  const bookingId = Number(body.bookingId);
  const amount = Number(body.amount);
  const party = body.party === "supplier" ? "supplier" : "customer";

  if (!bookingId) return NextResponse.json({ error: "bookingId is required" }, { status: 400 });
  if (!isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Payment amount must be a positive number." }, { status: 400 });
  }

  // Supplier payouts, refunds and reversals are finance-controlled.
  if (party === "supplier" && !["FINANCE", "MANAGER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Only finance can record supplier payments." }, { status: 403 });
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  // Agents may only post receipts against their own bookings.
  if (!canAccessRecord(session, booking, "agentId")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const currency = (body.currency || (party === "customer" ? booking.customerCurrency : booking.supplierCurrency) || baseCurrency()).toUpperCase();
  const baseAmount = await convert(amount, currency, baseCurrency());
  if (!isFinite(baseAmount)) {
    return NextResponse.json({ error: `No exchange rate for ${currency} → ${baseCurrency()}. Add one under Settings → Currency.` }, { status: 422 });
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        bookingId,
        party,
        direction: party === "customer" ? "in" : "out",
        supplierId: party === "supplier" ? booking.supplierId : null,
        amount,
        currency,
        baseAmount,
        method: body.method || "Bank transfer",
        reference: body.reference || null,
        status: "Paid",
        paidAt: new Date(),
        // customer receipts stay Unreconciled until finance matches them
        reconciledAt: null,
        recordedById: session.id,
      },
    });
    // Re-sum Paid rows in booking currency and advance milestone status (P1-07).
    return recomputeBookingPaid(tx, bookingId);
  });

  await logActivity({ userId: session.id, action: "payment", entityType: "bookings", entityId: bookingId, newValue: `${party} ${currency} ${amount}`, ip: getIp(req) });
  if (party === "customer") {
    const finance = await prisma.user.findMany({ where: { role: { in: ["FINANCE", "MANAGER"] }, active: true } });
    for (const f of finance) await notify(f.id, "Customer payment received (unreconciled)", `${booking.bookingRef || bookingId}: ${currency} ${amount}`, `/bookings/${bookingId}`);
  }

  return NextResponse.json({ ok: true, ...(result || {}) });
}
