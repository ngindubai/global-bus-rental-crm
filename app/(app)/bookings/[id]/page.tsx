"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiGet, apiSend } from "@/lib/api";
import { Badge, Spinner } from "@/components/ui";
import { fmtDate, fmtDateTime, money } from "@/lib/ui";
import { PAYMENT_METHODS, CURRENCIES } from "@/lib/constants";

// Booking workspace — organised around READINESS and the single NEXT ACTION, not an
// editable status dropdown. Every state change happens through a guarded command.
export default function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [me, setMe] = useState<any>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("overview");

  const load = useCallback(async () => {
    try {
      const d = await apiGet(`/api/bookings/${id}`);
      setData(d);
    } catch (e: any) { setErr(e.message); }
  }, [id]);

  useEffect(() => { load(); apiGet("/api/auth/me").then(setMe).catch(() => {}); }, [load]);

  if (err) return <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</div>;
  if (!data) return <Spinner />;
  const b = data.booking;
  const ps = data.paymentState;
  const rd = data.readiness;
  const na = data.nextAction;
  const isFinance = me && ["FINANCE", "MANAGER", "ADMIN"].includes(me.user?.role || me.role);
  const cur = b.customerCurrency || "USD";

  const stageTone: Record<string, string> = {
    PROVISIONAL: "bg-amber-100 text-amber-800", CONFIRMED: "bg-green-100 text-green-800",
    IN_SERVICE: "bg-blue-100 text-blue-800", COMPLETED: "bg-gray-200 text-gray-700", CANCELLED: "bg-red-100 text-red-700",
  };
  const readinessTone: Record<string, string> = { READY: "bg-green-100 text-green-800", ATTENTION: "bg-amber-100 text-amber-800", BLOCKED: "bg-red-100 text-red-700" };

  const tabs = [
    ["overview", "Overview"], ["legs", "Itinerary & legs"], ["payments", "Payments"],
    ["documents", "Documents"], ["tasks", "Tasks"], ["history", "Activity"],
  ];

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="card p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link href="/bookings" className="text-sm text-brand-600 hover:underline">← Bookings</Link>
            <h1 className="text-2xl mt-1">{b.bookingRef || `Booking ${b.id}`}</h1>
            <div className="text-sm text-muted">
              {b.lead?.customerName}{b.brand?.name ? ` · ${b.brand.name}` : ""} · Agent: {b.agent?.name || "—"} · Next travel: {fmtDate(b.travelDate)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2 flex-wrap justify-end">
              <span className={`text-xs font-bold px-2 py-1 rounded-full ${stageTone[b.operationalStage] || "bg-gray-100"}`}>{b.operationalStage}</span>
              <span className={`text-xs font-bold px-2 py-1 rounded-full ${readinessTone[rd.readiness]}`}>Readiness: {rd.readiness}</span>
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">Customer: {ps.state.replace(/_/g, " ")}</span>
              <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">Supplier: {legSummary(b.legs)}</span>
            </div>
          </div>
        </div>
        {/* Next action */}
        {na && na.kind !== "none" && (
          <div className="mt-3 flex items-center gap-3 flex-wrap bg-brand-50 rounded-lg px-3 py-2">
            <span className="text-sm font-semibold text-brand-800">Next action:</span>
            <NextActionButton na={na} booking={b} isFinance={isFinance} onDone={load} />
          </div>
        )}
        {b.confirmationReason && <div className="mt-2 text-xs text-green-700">✓ {b.confirmationReason}</div>}
      </div>

      {/* ── Summary KPIs ── */}
      <div className="grid md:grid-cols-4 gap-3">
        <Card label="Customer balance" value={money(b.customerBalance, cur)} tone={b.customerBalance > 0 ? "warn" : "ok"} sub={`Paid ${money(ps.paid, cur)} of ${money(ps.total, cur)}`} />
        <Card label="Required now" value={money(ps.requiredNow, cur)} tone={ps.requiredNow > 0 ? "warn" : "ok"} sub={ps.confirmationSatisfied ? "Confirmation met ✓" : `Needs ${money(ps.confirmationRequired, cur)}`} />
        <Card label="Supplier balance" value={money(b.supplierBalance, b.supplierCurrency)} tone={b.supplierBalance > 0 ? "warn" : "ok"} sub={`Cost ${money(b.supplierCost, b.supplierCurrency)}`} />
        <Card label="Gross profit (info)" value={money(b.grossProfit, cur)} tone="ok" sub={`${b.margin ?? 0}% margin · not a blocker`} />
      </div>

      {/* Readiness reasons */}
      {(rd.blockers.length > 0 || rd.warnings.length > 0) && (
        <div className="card p-4">
          <h2 className="text-base font-bold mb-2">Readiness</h2>
          {rd.blockers.map((x: string, i: number) => <div key={`b${i}`} className="text-sm text-red-700">⛔ {x}</div>)}
          {rd.warnings.map((x: string, i: number) => <div key={`w${i}`} className="text-sm text-amber-700">⚠️ {x}</div>)}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 ${tab === k ? "border-brand-600 text-brand-700 font-semibold" : "border-transparent text-muted"}`}>{label}</button>
        ))}
      </div>

      {tab === "overview" && <Overview b={b} ps={ps} rd={rd} />}
      {tab === "legs" && <Legs b={b} onDone={load} />}
      {tab === "payments" && <Payments b={b} ps={ps} isFinance={isFinance} onDone={load} />}
      {tab === "documents" && <Documents b={b} />}
      {tab === "tasks" && <Tasks tasks={data.tasks} />}
      {tab === "history" && <History events={b.events} />}
    </div>
  );
}

function legSummary(legs: any[]) {
  const active = (legs || []).filter((l) => !l.cancelledAt);
  const accepted = active.filter((l) => l.supplierConfirmation === "ACCEPTED").length;
  return `${accepted}/${active.length} accepted`;
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

function Overview({ b, ps, rd }: any) {
  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <section className="card p-4">
        <h2 className="text-base font-bold mb-2">Trip</h2>
        <dl className="text-sm space-y-1">
          <Row k="Route" v={`${b.pickupLocation || "?"} → ${b.dropoffLocation || "?"}`} />
          <Row k="Travel" v={`${fmtDate(b.travelDate)} ${b.travelTime || ""}`} />
          <Row k="Passengers" v={b.passengerCount || "—"} />
          <Row k="Legs" v={(b.legs || []).length} />
          <Row k="Stage" v={<Badge value={b.operationalStage} />} />
          <Row k="Customer acceptance" v={<Badge value={b.customerAcceptance} />} />
          <Row k="Financial closure" v={<Badge value={b.financialClosure} />} />
        </dl>
      </section>
      <section className="card p-4">
        <h2 className="text-base font-bold mb-2">Blockers & status</h2>
        {rd.readiness === "READY" && rd.blockers.length === 0 ? (
          <p className="text-sm text-green-700">Ready to travel — no outstanding blockers.</p>
        ) : (
          <>
            {rd.blockers.map((x: string, i: number) => <div key={i} className="text-sm text-red-700">⛔ {x}</div>)}
            {rd.warnings.map((x: string, i: number) => <div key={i} className="text-sm text-amber-700">⚠️ {x}</div>)}
          </>
        )}
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return <div className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="font-medium text-right">{v}</dd></div>;
}

function Legs({ b, onDone }: any) {
  return (
    <div className="space-y-4">
      {(b.legs || []).map((l: any) => (
        <section key={l.id} className="card p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="font-bold">Leg {l.legIndex} · {l.serviceType || "Service"}</div>
              <div className="text-sm text-muted">{l.pickupLocation || "?"} → {l.dropoffLocation || "?"} · {fmtDate(l.serviceDate)} {l.serviceTime || ""} · {l.passengerCount || "?"} pax</div>
              <div className="text-sm mt-1">Customer {money(l.customerAmount, l.customerCurrency)} · Supplier {money(l.supplierAmount, l.supplierCurrency)}</div>
            </div>
            <Badge value={l.supplierConfirmation} />
          </div>
          <div className="mt-2 text-sm grid sm:grid-cols-2 gap-x-6">
            <Row k="Supplier" v={l.supplier?.companyName || "Unassigned"} />
            <Row k="Driver" v={l.driverName || "—"} />
            <Row k="Vehicle" v={[l.vehicleType, l.vehicleRegistration].filter(Boolean).join(" · ") || "—"} />
            <Row k="Emergency contact" v={l.emergencyContact || "—"} />
          </div>
          {l.supplierAcceptances?.length > 0 && (
            <div className="mt-2 text-xs text-muted">Accepted {fmtDateTime(l.supplierAcceptances[0].acceptedAt)} via {l.supplierAcceptances[0].channel} · {money(l.supplierAcceptances[0].agreedAmount, l.supplierAcceptances[0].agreedCurrency)}</div>
          )}
          {l.supplierConfirmation !== "ACCEPTED" && !l.cancelledAt && <SupplierAcceptanceForm booking={b} leg={l} onDone={onDone} />}
        </section>
      ))}
    </div>
  );
}

function SupplierAcceptanceForm({ booking, leg, onDone }: any) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ supplierId: leg.supplierId || "", agreedAmount: leg.supplierAmount || "", agreedCurrency: leg.supplierCurrency || "USD", channel: "phone", acceptingContact: "", agreedTerms: "" });
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!f.supplierId || !f.agreedAmount) { alert("Supplier and agreed amount are required."); return; }
    setBusy(true);
    try {
      await apiSend(`/api/bookings/${booking.id}/legs/${leg.id}/record-supplier-acceptance`, "POST", { ...f, supplierId: Number(f.supplierId), agreedAmount: Number(f.agreedAmount) });
      onDone();
    } catch (e: any) { alert(e.message); }
    setBusy(false);
  }
  if (!open) return <button className="btn-primary !py-1.5 mt-2" onClick={() => setOpen(true)}>Record supplier acceptance</button>;
  return (
    <div className="mt-3 bg-surface rounded-lg p-3 flex flex-wrap items-end gap-2">
      <div><label className="label">Supplier ID</label><input className="input !py-1.5 w-24" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} /></div>
      <div><label className="label">Amount</label><input className="input !py-1.5 w-24" type="number" value={f.agreedAmount} onChange={(e) => setF({ ...f, agreedAmount: e.target.value })} /></div>
      <div><label className="label">Currency</label><select className="select !py-1.5" value={f.agreedCurrency} onChange={(e) => setF({ ...f, agreedCurrency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
      <div><label className="label">Channel</label><select className="select !py-1.5" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="other">Other</option></select></div>
      <div><label className="label">Contact</label><input className="input !py-1.5 w-28" value={f.acceptingContact} onChange={(e) => setF({ ...f, acceptingContact: e.target.value })} /></div>
      <button className="btn-primary !py-1.5" disabled={busy} onClick={submit}>Save acceptance</button>
      <button className="btn-secondary !py-1.5" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

function Payments({ b, ps, isFinance, onDone }: any) {
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-base font-bold">Payments & reconciliation</h2>
        <div className="text-sm text-muted">Customer balance {money(b.customerBalance, b.customerCurrency)}</div>
      </div>
      <RecordReceipt booking={b} onDone={onDone} />
      <table className="w-full text-sm mt-3">
        <thead><tr className="text-muted text-left"><th className="th">Date</th><th className="th">Kind</th><th className="th">Method</th><th className="th text-right">Amount</th><th className="th">Recorder</th><th className="th">Reconciled</th>{isFinance && <th className="th"></th>}</tr></thead>
        <tbody>
          {(b.payments || []).length === 0 && <tr><td className="td text-muted" colSpan={7}>No payments recorded.</td></tr>}
          {(b.payments || []).map((p: any) => (
            <tr key={p.id} className={`border-t border-gray-100 ${p.status === "Reversed" ? "opacity-50 line-through" : ""}`}>
              <td className="td text-xs">{fmtDateTime(p.paidAt || p.createdAt)}</td>
              <td className="td capitalize">{p.kind?.replace(/_/g, " ")}{p.reversalOfId ? ` · of #${p.reversalOfId}` : ""}</td>
              <td className="td">{p.method}</td>
              <td className={`td text-right ${p.direction === "out" ? "text-red-600" : ""}`}>{p.direction === "out" ? "−" : ""}{money(p.amount, p.currency)}</td>
              <td className="td text-xs">{p.recordedBy?.name || "—"}</td>
              <td className="td text-xs">{p.party === "customer" && p.kind === "receipt" ? (p.reconciledAt ? `✓ ${p.reconciledBy?.name || ""}` : <span className="text-amber-600">Unreconciled</span>) : "—"}</td>
              {isFinance && (
                <td className="td text-right">
                  {p.party === "customer" && p.kind === "receipt" && !p.reconciledAt && p.status !== "Reversed" && (
                    <button className="text-brand-600 text-xs hover:underline" onClick={async () => { await apiSend(`/api/payments/${p.id}/reconcile`, "POST", { action: "reconcile" }); onDone(); }}>Reconcile</button>
                  )}
                  {p.kind !== "reversal" && p.status !== "Reversed" && (
                    <button className="text-red-600 text-xs hover:underline ml-2" onClick={async () => { const reason = prompt("Reason for reversal?"); if (!reason) return; try { await apiSend(`/api/payments/${p.id}/reverse`, "POST", { reason }); onDone(); } catch (e: any) { alert(e.message); } }}>Reverse</button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!ps.confirmationSatisfied && <p className="text-xs text-muted mt-2">Confirmation requires {money(ps.confirmationRequired, b.customerCurrency)} received.</p>}
    </section>
  );
}

function RecordReceipt({ booking, onDone }: any) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(booking.customerCurrency || "USD");
  const [method, setMethod] = useState("Bank transfer");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  async function record() {
    if (!amount) return;
    setBusy(true);
    // Client-generated idempotency key so an accidental double-submit is a no-op.
    const idempotencyKey = `rcpt-${booking.id}-${Date.now()}-${Math.round(Number(amount) * 100)}`;
    try {
      await apiSend("/api/payments/record", "POST", { bookingId: booking.id, amount: Number(amount), currency, method, reference, idempotencyKey });
      setAmount(""); setReference(""); onDone();
    } catch (e: any) { alert(e.message); }
    setBusy(false);
  }
  return (
    <div className="bg-surface rounded-lg p-3 flex flex-wrap items-end gap-2">
      <div className="text-sm font-semibold w-full">Record customer receipt</div>
      <div><label className="label">Amount</label><input className="input !py-1.5 w-28" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div><label className="label">Currency</label><select className="select !py-1.5" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
      <div><label className="label">Method</label><select className="select !py-1.5" value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
      <div><label className="label">Reference</label><input className="input !py-1.5 w-32" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
      <button className="btn-primary !py-1.5" disabled={busy} onClick={record}>Record receipt</button>
    </div>
  );
}

function Documents({ b }: any) {
  return (
    <section className="card p-4">
      <h2 className="text-base font-bold mb-3">Documents</h2>
      <div className="flex flex-col gap-2 text-sm max-w-sm">
        <a className="btn-secondary justify-start" href={`/api/documents/invoice/${b.id}`} target="_blank" rel="noreferrer">🧾 Customer invoice</a>
        <a className="btn-secondary justify-start" href={`/api/documents/confirmation/${b.id}`} target="_blank" rel="noreferrer">✅ Booking confirmation</a>
        <a className="btn-secondary justify-start" href={`/api/documents/receipt/${b.id}`} target="_blank" rel="noreferrer">📩 Receipt</a>
        <a className="btn-secondary justify-start" href={`/api/documents/po/${b.id}`} target="_blank" rel="noreferrer">📄 Supplier purchase order</a>
      </div>
    </section>
  );
}

function Tasks({ tasks }: any) {
  return (
    <section className="card p-4">
      <h2 className="text-base font-bold mb-3">Tasks & deadlines</h2>
      {(!tasks || tasks.length === 0) ? <p className="text-sm text-muted">No tasks.</p> : (
        <ul className="text-sm divide-y divide-gray-100">
          {tasks.map((t: any) => (
            <li key={t.id} className="py-2 flex items-center justify-between gap-3">
              <span className={t.status === "Completed" ? "line-through text-muted" : ""}>{t.title}</span>
              <span className="text-xs text-muted">{t.dueDate ? fmtDate(t.dueDate) : ""} · <Badge value={t.status} /></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function History({ events }: any) {
  return (
    <section className="card p-4">
      <h2 className="text-base font-bold mb-3">Activity & audit history</h2>
      {(!events || events.length === 0) ? <p className="text-sm text-muted">No events.</p> : (
        <ul className="text-sm space-y-2">
          {events.map((e: any) => (
            <li key={e.id} className="flex gap-3">
              <span className="text-xs text-muted whitespace-nowrap">{fmtDateTime(e.createdAt)}</span>
              <span className="font-medium capitalize">{e.type?.replace(/_/g, " ")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NextActionButton({ na, booking, isFinance, onDone }: any) {
  const [busy, setBusy] = useState(false);
  async function run() {
    if (na.kind === "record_supplier_acceptance") { document.querySelector('[data-legs-tab]')?.dispatchEvent(new Event("click")); alert("Open the Itinerary & legs tab and record the supplier acceptance for the highlighted leg."); return; }
    if (na.kind === "reconcile") { alert("Open the Payments tab to reconcile receipts."); return; }
    if (na.kind === "complete") {
      if (!confirm("Record this booking as completed?")) return;
      setBusy(true);
      try { await apiSend(`/api/bookings/${booking.id}/complete`, "POST", { outcome: "completed" }); onDone(); }
      catch (e: any) { alert(e.message); }
      setBusy(false); return;
    }
    alert("See the relevant tab to complete this action.");
  }
  return <button className="btn-primary !py-1.5" disabled={busy} onClick={run}>{na.label}</button>;
}
