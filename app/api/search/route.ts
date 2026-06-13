import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json({ results: [] });

  const ins = { contains: q, mode: "insensitive" as const };
  const [leads, customers, suppliers, bookings, quotes] = await Promise.all([
    prisma.lead.findMany({
      where: { deletedAt: null, OR: [{ customerName: ins }, { companyName: ins }, { email: ins }, { phone: ins }, { leadRef: ins }] },
      take: 6, select: { id: true, customerName: true, leadRef: true },
    }),
    prisma.customer.findMany({
      where: { deletedAt: null, OR: [{ name: ins }, { companyName: ins }, { email: ins }, { phone: ins }] },
      take: 5, select: { id: true, name: true },
    }),
    prisma.supplier.findMany({
      where: { deletedAt: null, OR: [{ companyName: ins }, { contactPerson: ins }, { email: ins }] },
      take: 5, select: { id: true, companyName: true },
    }),
    prisma.booking.findMany({
      where: { deletedAt: null, OR: [{ bookingRef: ins }, { city: ins }] },
      take: 5, select: { id: true, bookingRef: true, city: true },
    }),
    prisma.quote.findMany({
      where: { deletedAt: null, OR: [{ quoteRef: ins }] },
      take: 5, select: { id: true, quoteRef: true },
    }),
  ]);

  const results = [
    ...leads.map((l) => ({ type: "Lead", label: `${l.customerName} ${l.leadRef ? `(${l.leadRef})` : ""}`, href: `/leads/${l.id}` })),
    ...customers.map((c) => ({ type: "Customer", label: c.name, href: `/customers` })),
    ...suppliers.map((s) => ({ type: "Supplier", label: s.companyName, href: `/suppliers` })),
    ...bookings.map((b) => ({ type: "Booking", label: `${b.bookingRef || b.id} ${b.city || ""}`, href: `/bookings/${b.id}` })),
    ...quotes.map((qt) => ({ type: "Quote", label: qt.quoteRef || `Quote ${qt.id}`, href: `/quotes` })),
  ];
  return NextResponse.json({ results });
}
