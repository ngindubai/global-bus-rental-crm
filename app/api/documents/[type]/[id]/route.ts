import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, logActivity, getIp } from "@/lib/auth";
import { renderDocument, DocSpec } from "@/lib/docs";

export const dynamic = "force-dynamic";

const dt = (d?: Date | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

// GET /api/documents/:type/:id  → branded printable HTML (PDF via browser print)
// type: quote | invoice | confirmation | receipt | po
export async function GET(req: NextRequest, { params }: { params: { type: string; id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const id = Number(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let spec: DocSpec | null = null;

  if (params.type === "quote") {
    const q = await prisma.quote.findUnique({ where: { id }, include: { lead: true, brand: true, items: true } });
    if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });
    spec = {
      kind: "Quote",
      ref: q.quoteRef || `Q-${q.id}`,
      date: dt(q.createdAt),
      validUntil: q.validUntil ? dt(q.validUntil) : null,
      brand: q.brand,
      party: { label: "Prepared for", name: q.lead.customerName, lines: [q.lead.companyName || "", q.lead.email || "", q.lead.phone || ""].filter(Boolean) },
      meta: [
        { label: "Trip", value: `${q.lead.pickupLocation || "?"} → ${q.lead.dropoffLocation || "?"}` },
        { label: "Travel date", value: dt(q.lead.travelDate) },
        { label: "Passengers", value: String(q.lead.passengerCount ?? "—") },
      ],
      rows: q.items.map((i) => ({ description: i.description, qty: i.qty, unit: i.customerPrice, amount: (i.customerPrice || 0) * i.qty })),
      currency: q.customerCurrency || "USD",
      total: q.customerPrice || 0,
      footer: q.brand?.quoteFooter,
      notes: null,
    };
  } else if (params.type === "invoice" || params.type === "confirmation" || params.type === "receipt") {
    const b = await prisma.booking.findUnique({ where: { id }, include: { brand: true, lead: true, customer: true, supplier: true } });
    if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const name = b.customer?.name || b.lead?.customerName || "Customer";
    const base = {
      ref: b.bookingRef || `B-${b.id}`,
      date: dt(b.createdAt),
      brand: b.brand,
      party: { label: "Bill to", name, lines: [b.lead?.email || "", b.lead?.phone || ""].filter(Boolean) },
      meta: [
        { label: "Trip", value: `${b.pickupLocation || "?"} → ${b.dropoffLocation || "?"}` },
        { label: "Travel date", value: dt(b.travelDate) },
        { label: "Passengers", value: String(b.passengerCount ?? "—") },
      ],
      rows: [{ description: `Passenger transport — ${b.city || ""}`, qty: 1, unit: b.customerInvoiceAmount, amount: b.customerInvoiceAmount }],
      currency: b.customerCurrency || "USD",
      total: b.customerInvoiceAmount || 0,
    };
    if (params.type === "invoice") spec = { kind: "Invoice", ...base, paid: b.customerPaidAmount, footer: b.brand?.invoiceFooter };
    else if (params.type === "receipt") spec = { kind: "Receipt", ...base, paid: b.customerPaidAmount, total: b.customerPaidAmount || 0, footer: b.brand?.invoiceFooter };
    else spec = { kind: "Booking Confirmation", ...base, footer: b.brand?.quoteFooter };
  } else if (params.type === "po") {
    const b = await prisma.booking.findUnique({ where: { id }, include: { brand: true, supplier: true, lead: true } });
    if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
    spec = {
      kind: "Supplier Purchase Order",
      ref: `PO-${b.bookingRef || b.id}`,
      date: dt(b.createdAt),
      brand: b.brand,
      party: { label: "Supplier", name: b.supplier?.companyName || "Supplier", lines: [b.supplier?.contactPerson || "", b.supplier?.email || ""].filter(Boolean) },
      meta: [
        { label: "Trip", value: `${b.pickupLocation || "?"} → ${b.dropoffLocation || "?"}` },
        { label: "Travel date", value: dt(b.travelDate) },
        { label: "Passengers", value: String(b.passengerCount ?? "—") },
      ],
      rows: [{ description: `Transport service — ${b.city || ""}`, qty: 1, unit: b.supplierCost, amount: b.supplierCost }],
      currency: b.supplierCurrency || "USD",
      total: b.supplierCost || 0,
      paid: b.supplierPaidAmount,
      footer: "Please confirm availability and provide driver/vehicle details before travel.",
    };
  }

  if (!spec) return NextResponse.json({ error: "Unknown document type" }, { status: 400 });

  await logActivity({ userId: session.id, action: "document", entityType: params.type, entityId: id, ip: getIp(req) });
  return new NextResponse(renderDocument(spec), { headers: { "content-type": "text/html; charset=utf-8" } });
}
