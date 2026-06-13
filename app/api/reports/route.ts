import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/reports?dimension=agent|country|supplier|booking&from=&to=&format=json|csv
// Profit reporting (Modules 13 & 23).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const dimension = sp.get("dimension") || "agent";
  const from = sp.get("from");
  const to = sp.get("to");
  const format = sp.get("format") || "json";

  const where: any = { deletedAt: null };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to + "T23:59:59");
  }

  const bookings = await prisma.booking.findMany({
    where,
    include: {
      agent: { select: { name: true } },
      supplier: { select: { companyName: true } },
    },
  });

  const groups = new Map<string, { key: string; bookings: number; revenue: number; supplierCost: number; profit: number }>();
  const countryNames = new Map<number, string>();
  if (dimension === "country") {
    const cs = await prisma.country.findMany({ select: { id: true, name: true } });
    cs.forEach((c) => countryNames.set(c.id, c.name));
  }

  for (const b of bookings) {
    let key = "—";
    if (dimension === "agent") key = b.agent?.name || "Unassigned";
    else if (dimension === "supplier") key = b.supplier?.companyName || "No supplier";
    else if (dimension === "country") key = b.countryId ? countryNames.get(b.countryId) || `#${b.countryId}` : "—";
    else if (dimension === "booking") key = b.bookingRef || `B-${b.id}`;

    const g = groups.get(key) || { key, bookings: 0, revenue: 0, supplierCost: 0, profit: 0 };
    g.bookings += 1;
    g.revenue += b.customerInvoiceAmount || 0;
    g.supplierCost += b.supplierCost || 0;
    g.profit += b.grossProfit || 0;
    groups.set(key, g);
  }

  const rows = Array.from(groups.values())
    .map((g) => ({ ...g, revenue: round(g.revenue), supplierCost: round(g.supplierCost), profit: round(g.profit), margin: g.revenue ? round((g.profit / g.revenue) * 100) : 0 }))
    .sort((a, b) => b.profit - a.profit);

  if (format === "csv") {
    const header = "Key,Bookings,Revenue,SupplierCost,Profit,Margin%";
    const body = rows.map((r) => `"${r.key}",${r.bookings},${r.revenue},${r.supplierCost},${r.profit},${r.margin}`).join("\n");
    return new NextResponse(`${header}\n${body}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="report-${dimension}.csv"`,
      },
    });
  }

  const totals = rows.reduce(
    (t, r) => ({ bookings: t.bookings + r.bookings, revenue: round(t.revenue + r.revenue), profit: round(t.profit + r.profit) }),
    { bookings: 0, revenue: 0, profit: 0 }
  );
  return NextResponse.json({ dimension, rows, totals });
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
