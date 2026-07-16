import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canWrite, canAccessRecord, logActivity, getIp } from "@/lib/auth";
import { makeRef } from "@/lib/registry";
import { getRateStrict, profitAndMargin, baseCurrency, MissingRateError } from "@/lib/currency";

export const dynamic = "force-dynamic";

// POST { leadId, serviceLineIds?, customerCurrency?, validDays? }
// Builds a quote from a lead's service lines, summing supplier cost + customer
// price, applying FX, and creating one QuoteItem per line.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canWrite(session.role, "quotes")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const { leadId, serviceLineIds, customerCurrency, validDays } = await req.json();
  const lead = await prisma.lead.findUnique({ where: { id: Number(leadId) }, include: { serviceLines: true } });
  if (!lead || lead.deletedAt) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  // object-level authorisation (P0-02): agents only build quotes for their leads
  if (!canAccessRecord(session, lead, "assignedToId")) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const lines = lead.serviceLines.filter((sl) => !serviceLineIds || serviceLineIds.includes(sl.id));
  if (lines.length === 0) return NextResponse.json({ error: "No service lines to quote" }, { status: 400 });

  const custCur = customerCurrency || lead.serviceLines[0]?.currency || baseCurrency();
  let supplierCostBase = 0;
  let customerPrice = 0;
  const items: any[] = [];
  try {
  for (const sl of lines) {
    // Strict FX: refuse to price a line when the rate is unknown rather than
    // silently assuming 1:1 and mispricing the quote (P0-05).
    const rate = await getRateStrict(sl.currency, custCur);
    const lineCustomer = (sl.customerPrice || 0) * rate;
    supplierCostBase += (sl.supplierCost || 0) * rate;
    customerPrice += lineCustomer;
    items.push({
      serviceLineId: sl.id,
      description: `${sl.serviceType || "Service"}: ${sl.pickupLocation || "?"} → ${sl.dropoffLocation || "?"}${sl.passengerCount ? ` (${sl.passengerCount} pax)` : ""}`,
      supplierCost: Math.round((sl.supplierCost || 0) * rate * 100) / 100,
      customerPrice: Math.round(lineCustomer * 100) / 100,
      currency: custCur,
      qty: 1,
    });
  }
  } catch (e) {
    if (e instanceof MissingRateError) {
      return NextResponse.json(
        { error: `Cannot build quote: ${e.message}. Add a manual exchange rate under Settings → Currency and try again.` },
        { status: 422 }
      );
    }
    throw e;
  }

  const { profit, margin } = profitAndMargin(round(supplierCostBase), round(customerPrice));
  // supersede previous draft/sent quotes
  await prisma.quote.updateMany({ where: { leadId: lead.id, status: { in: ["Draft", "Sent"] }, deletedAt: null }, data: { status: "Superseded" } });
  const version = (await prisma.quote.count({ where: { leadId: lead.id } })) + 1;

  const quote = await prisma.quote.create({
    data: {
      leadId: lead.id,
      brandId: lead.brandId,
      version,
      customerCurrency: custCur,
      supplierCurrency: custCur,
      exchangeRate: 1,
      supplierCost: round(supplierCostBase),
      customerPrice: round(customerPrice),
      profit,
      margin,
      validUntil: new Date(Date.now() + (Number(validDays) || 7) * 24 * 60 * 60 * 1000),
      status: "Draft",
      createdById: session.id,
      items: { create: items },
    },
    include: { items: true },
  });
  await prisma.quote.update({ where: { id: quote.id }, data: { quoteRef: makeRef("Q", quote.id) } });
  await prisma.lead.update({ where: { id: lead.id }, data: { status: "Quote Prepared" } }).catch(() => {});
  await logActivity({ userId: session.id, action: "create", entityType: "quotes", entityId: quote.id, ip: getIp(req) });

  return NextResponse.json({ quoteId: quote.id }, { status: 201 });
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
