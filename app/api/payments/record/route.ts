import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canWrite, logActivity, getIp, notify } from "@/lib/auth";
import { convert, baseCurrency } from "@/lib/currency";

export const dynamic = "force-dynamic";

// POST — record a manual payment (customer in / supplier out) and roll the
// booking's paid totals + status forward. body:
// { bookingId, party: 'customer'|'supplier', amount, currency, method, reference, markPaid }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canWrite(session.role, "payments")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const body = await req.json();
  const bookingId = Number(body.bookingId);
  const amount = Number(body.amount);
  const party = body.party === "supplier" ? "supplier" : "customer";
  if (!bookingId || !amount) return NextResponse.json({ error: "bookingId and amount are required" }, { status: 400 });

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const currency = body.currency || (party === "customer" ? booking.customerCurrency : booking.supplierCurrency) || baseCurrency();
  const baseAmount = await convert(amount, currency, baseCurrency());

  await prisma.payment.create({
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
      recordedById: session.id,
    },
  });

  // re-sum paid amounts from Paid rows
  const paidRows = await prisma.payment.findMany({ where: { bookingId, status: "Paid" } });
  const customerPaid = sum(paidRows.filter((p) => p.party === "customer").map((p) => p.amount));
  const supplierPaid = sum(paidRows.filter((p) => p.party === "supplier").map((p) => p.amount));

  const patch: any = { customerPaidAmount: customerPaid, supplierPaidAmount: supplierPaid };
  // advance status based on payment milestones
  if (customerPaid >= (booking.customerInvoiceAmount || 0) && booking.status === "Awaiting Customer Payment") {
    patch.status = "Customer Paid";
  }
  if (supplierPaid >= (booking.supplierCost || 0) && ["Customer Paid", "Supplier Payment Pending"].includes(patch.status || booking.status)) {
    patch.status = "Supplier Paid";
  }
  await prisma.booking.update({ where: { id: bookingId }, data: patch });

  await logActivity({ userId: session.id, action: "payment", entityType: "bookings", entityId: bookingId, newValue: `${party} ${currency} ${amount}`, ip: getIp(req) });
  if (party === "customer") {
    const finance = await prisma.user.findMany({ where: { role: { in: ["FINANCE", "MANAGER"] }, active: true } });
    for (const f of finance) await notify(f.id, "Customer payment received", `${booking.bookingRef || bookingId}: ${currency} ${amount}`, `/bookings/${bookingId}`);
  }

  return NextResponse.json({ ok: true, customerPaid, supplierPaid, status: patch.status || booking.status });
}

function sum(a: number[]) {
  return Math.round(a.reduce((s, n) => s + n, 0) * 100) / 100;
}
