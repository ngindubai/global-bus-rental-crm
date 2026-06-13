import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getRate, baseCurrency } from "@/lib/currency";
import { fxConfigured } from "@/lib/integrations/fx";

export const dynamic = "force-dynamic";

// GET — list stored rates (+ optional ?from=&to= live lookup)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (from && to) {
    const rate = await getRate(from, to);
    return NextResponse.json({ from, to, rate });
  }
  const rates = await prisma.exchangeRate.findMany({ orderBy: [{ base: "asc" }, { quote: "asc" }] });
  return NextResponse.json({ base: baseCurrency(), configured: fxConfigured(), rates });
}

// POST — set a manual rate override. body: { base, quote, rate }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["ADMIN", "MANAGER", "FINANCE"].includes(session.role)) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  const { base, quote, rate } = await req.json();
  if (!base || !quote || !rate) return NextResponse.json({ error: "base, quote and rate are required" }, { status: 400 });
  const r = await prisma.exchangeRate.upsert({
    where: { base_quote: { base: base.toUpperCase(), quote: quote.toUpperCase() } },
    create: { base: base.toUpperCase(), quote: quote.toUpperCase(), rate: Number(rate), source: "manual" },
    update: { rate: Number(rate), source: "manual", fetchedAt: new Date() },
  });
  return NextResponse.json({ rate: r });
}
