"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiGet, apiSend } from "@/lib/api";
import { Badge, Spinner } from "@/components/ui";
import { fmtDate, fmtDateTime, money } from "@/lib/ui";
import { BOOKING_STATUSES, PAYMENT_METHODS, CURRENCIES } from "@/lib/constants";

export default function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const [b, setB] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const d = await apiGet(`/api/crud/bookings/${id}`);
    setB(d.item);
    const p = await apiGet(`/api/crud/payments?f_bookingId=${id}`);
    setPayments(p.items || []);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function patch(body: any) {
    setErr("");
    try { await apiSend(`/api/crud/bookings/${id}`, "PATCH", body); load(); }
    catch (e: any) { setErr(e.message); }
  }
  async function stripeLink() {
    try {
      const r = await apiSend("/api/payments/stripe-link", "POST", { bookingId: Number(id) });
      if (r.stub) alert("Stripe not configured — placeholder link created. See SETUP-TASKS.html to connect Stripe.");
      else window.open(r.url, "_blank");
      load();
    } catch (e: any) { alert(e.message); }
  }

  if (!b) return <Spinner />;
  const custOutstanding = (b.customerInvoiceAmount || 0) - (b.customerPaidAmount || 0);
  const supOutstanding = (b.supplierCost || 0) - (b.supplierPaidAmount || 0);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/bookings" className="text-sm text-brand-600 hover:underline">← Bookings</Link>
          <h1 className="text-2xl mt-1">{b.bookingRef || `Booking ${b.id}`}</h1>
          <div className="text-sm text-muted">{b.lead?.customerName} · {b.pickupLocation} → {b.dropoffLocation} · {fmtDate(b.travelDate)}</div>
        </div>
        <select className="select !py-1.5 max-w-[230px]" value={b.status} onChange={(e) => patch({ status: e.target.value })}>
          {BOOKING_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      {err && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</div>}

      <div className="grid md:grid-cols-4 gap-3">
        <Card label="Customer invoice" value={money(b.customerInvoiceAmount, b.customerCurrency)} />
        <Card label="Customer paid" value={money(b.customerPaidAmount, b.customerCurrency)} tone={custOutstanding > 0 ? "warn" : "ok"} sub={custOutstanding > 0 ? `${money(custOutstanding, b.customerCurrency)} outstanding` : "Settled ✓"} />
        <Card label="Supplier cost" value={money(b.supplierCost, b.supplierCurrency)} />
        <Card label="Supplier paid" value={money(b.supplierPaidAmount, b.supplierCurrency)} tone={supOutstanding > 0 ? "warn" : "ok"} sub={supOutstanding > 0 ? `${money(supOutstanding, b.supplierCurrency)} outstanding` : "Settled ✓"} />
        <Card label="Gross profit" value={money(b.grossProfit, b.customerCurrency)} tone="ok" sub={`${b.margin ?? 0}% margin`} />
        <Card label="Status" value={<Badge value={b.status} />} />
        <Card label="Supplier" value={b.supplier?.companyName || "—"} />
        <Card label="Agent" value={b.agent?.name || "—"} />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <section className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold">Payments</h2>
              <div className="flex gap-2">
                <button className="btn-secondary !py-1.5" onClick={stripeLink} disabled={custOutstanding <= 0}>Stripe link</button>
              </div>
            </div>
            <RecordPayment booking={b} onDone={load} />
            <table className="w-full text-sm mt-3">
              <thead><tr className="text-muted text-left"><th className="th">Date</th><th className="th">Party</th><th className="th">Method</th><th className="th text-right">Amount</th><th className="th">Status</th></tr></thead>
              <tbody>
                {payments.length === 0 && <tr><td className="td text-muted" colSpan={5}>No payments recorded.</td></tr>}
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="td text-xs">{fmtDateTime(p.paidAt || p.createdAt)}</td>
                    <td className="td capitalize">{p.party}</td>
                    <td className="td">{p.method}{p.stripeLinkUrl && !p.stripeLinkUrl.startsWith("#") && <a className="text-brand-600 ml-1" href={p.stripeLinkUrl} target="_blank" rel="noreferrer">↗</a>}</td>
                    <td className="td text-right">{money(p.amount, p.currency)}</td>
                    <td className="td"><Badge value={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="space-y-5">
          <section className="card p-4">
            <h2 className="text-base font-bold mb-3">Documents</h2>
            <div className="flex flex-col gap-2 text-sm">
              <a className="btn-secondary justify-start" href={`/api/documents/invoice/${b.id}`} target="_blank" rel="noreferrer">🧾 Customer invoice</a>
              <a className="btn-secondary justify-start" href={`/api/documents/confirmation/${b.id}`} target="_blank" rel="noreferrer">✅ Booking confirmation</a>
              <a className="btn-secondary justify-start" href={`/api/documents/receipt/${b.id}`} target="_blank" rel="noreferrer">📩 Receipt</a>
              <a className="btn-secondary justify-start" href={`/api/documents/po/${b.id}`} target="_blank" rel="noreferrer">📄 Supplier purchase order</a>
            </div>
          </section>
          {b.lead && (
            <section className="card p-4">
              <h2 className="text-base font-bold mb-2">Linked lead</h2>
              <Link href={`/leads/${b.leadId}`} className="text-brand-600 hover:underline text-sm">{b.lead.customerName} →</Link>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: "ok" | "warn" }) {
  const c = tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-green-700" : "text-ink";
  return (
    <div className="card p-3">
      <div className="kpi-label">{label}</div>
      <div className={`text-lg font-extrabold mt-0.5 ${c}`}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

function RecordPayment({ booking, onDone }: { booking: any; onDone: () => void }) {
  const [party, setParty] = useState("customer");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(booking.customerCurrency || "USD");
  const [method, setMethod] = useState("Bank transfer");
  const [busy, setBusy] = useState(false);

  async function record() {
    if (!amount) return;
    setBusy(true);
    try {
      await apiSend("/api/payments/record", "POST", { bookingId: booking.id, party, amount: Number(amount), currency, method });
      setAmount("");
      onDone();
    } catch (e: any) { alert(e.message); }
    setBusy(false);
  }

  return (
    <div className="bg-surface rounded-lg p-3 flex flex-wrap items-end gap-2">
      <div><label className="label">Party</label><select className="select !py-1.5" value={party} onChange={(e) => { setParty(e.target.value); setCurrency(e.target.value === "supplier" ? booking.supplierCurrency || "USD" : booking.customerCurrency || "USD"); }}><option value="customer">Customer (in)</option><option value="supplier">Supplier (out)</option></select></div>
      <div><label className="label">Amount</label><input className="input !py-1.5 w-28" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div><label className="label">Currency</label><select className="select !py-1.5" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
      <div><label className="label">Method</label><select className="select !py-1.5" value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
      <button className="btn-primary !py-1.5" disabled={busy} onClick={record}>Record payment</button>
    </div>
  );
}
