"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiGet, apiSend, list } from "@/lib/api";
import { Badge, Spinner } from "@/components/ui";
import { fmtDate, fmtDateTime, money } from "@/lib/ui";
import { LEAD_STATUSES, SERVICE_TYPES, REQUEST_METHODS, COMM_CHANNELS, COMM_DIRECTIONS, CURRENCIES } from "@/lib/constants";

export default function LeadWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<any>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const d = await apiGet(`/api/leads/${id}`);
    setLead(d.lead);
  }, [id]);

  useEffect(() => {
    load();
    list("suppliers", "take=500").then((d) => setSuppliers(d.items || []));
    apiGet("/api/users").then((d) => setUsers(d.items || [])).catch(() => {});
  }, [id, load]);

  async function patch(body: any) {
    setErr("");
    try {
      await apiSend(`/api/crud/leads/${id}`, "PATCH", body);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  if (!lead) return <Spinner />;

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/leads" className="text-sm text-brand-600 hover:underline">← Leads</Link>
          <h1 className="text-2xl mt-1">{lead.customerName} {lead.companyName && <span className="text-muted text-lg">· {lead.companyName}</span>}</h1>
          <div className="text-sm text-muted">{lead.leadRef} · {lead.source} {lead.brand && `· ${lead.brand.name}`}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="select !py-1.5 max-w-[210px]" value={lead.status} onChange={(e) => patch({ status: e.target.value })}>
            {LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select className="select !py-1.5 max-w-[170px]" value={lead.assignedToId || ""} onChange={(e) => patch({ assignedToId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>
      {err && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</div>}

      {/* summary grid */}
      <div className="grid md:grid-cols-4 gap-3">
        <Info label="Phone" value={lead.phone} />
        <Info label="WhatsApp" value={lead.whatsapp} />
        <Info label="Email" value={lead.email} />
        <Info label="Country / City" value={[lead.country?.name, lead.city].filter(Boolean).join(" · ")} />
        <Info label="Trip" value={`${lead.pickupLocation || "?"} → ${lead.dropoffLocation || "?"}`} />
        <Info label="Travel" value={`${fmtDate(lead.travelDate)} ${lead.travelTime || ""}`} />
        <Info label="Passengers" value={lead.passengerCount} />
        <Info label="Priority" value={<Badge value={lead.priority} />} />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <ServiceLines lead={lead} reload={load} />
          <SupplierBroadcast lead={lead} suppliers={suppliers} reload={load} />
          <Quotes lead={lead} reload={load} />
          <Timeline lead={lead} reload={load} />
        </div>
        <div className="space-y-5">
          <AiPanel leadId={lead.id} />
          <StatusHistory lead={lead} />
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: any }) {
  return (
    <div className="card p-3">
      <div className="kpi-label">{label}</div>
      <div className="text-sm font-medium text-ink mt-0.5">{value || <span className="text-gray-400">—</span>}</div>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ── Service lines ────────────────────────────────────────────────────────────
function ServiceLines({ lead, reload }: { lead: any; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState<any>({ currency: "USD", serviceType: SERVICE_TYPES[0] });
  const set = (k: string, val: any) => setV((p: any) => ({ ...p, [k]: val }));

  async function add() {
    await apiSend("/api/crud/serviceLines", "POST", { ...v, leadId: lead.id });
    setAdding(false);
    setV({ currency: "USD", serviceType: SERVICE_TYPES[0] });
    reload();
  }

  return (
    <Section title="Service lines" action={<button className="btn-secondary !py-1.5" onClick={() => setAdding(!adding)}>+ Add</button>}>
      {adding && (
        <div className="bg-surface rounded-lg p-3 mb-3 grid grid-cols-2 gap-2">
          <select className="select" value={v.serviceType} onChange={(e) => set("serviceType", e.target.value)}>{SERVICE_TYPES.map((s) => <option key={s}>{s}</option>)}</select>
          <input className="input" placeholder="Vehicle requirement" value={v.vehicleRequirement || ""} onChange={(e) => set("vehicleRequirement", e.target.value)} />
          <input className="input" placeholder="Pickup" value={v.pickupLocation || ""} onChange={(e) => set("pickupLocation", e.target.value)} />
          <input className="input" placeholder="Drop-off" value={v.dropoffLocation || ""} onChange={(e) => set("dropoffLocation", e.target.value)} />
          <input className="input" type="number" placeholder="Passengers" value={v.passengerCount || ""} onChange={(e) => set("passengerCount", e.target.value)} />
          <select className="select" value={v.currency} onChange={(e) => set("currency", e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
          <input className="input" type="number" placeholder="Supplier cost" value={v.supplierCost || ""} onChange={(e) => set("supplierCost", e.target.value)} />
          <input className="input" type="number" placeholder="Customer price" value={v.customerPrice || ""} onChange={(e) => set("customerPrice", e.target.value)} />
          <div className="col-span-2 flex gap-2"><button className="btn-primary !py-1.5" onClick={add}>Save line</button><button className="btn-ghost !py-1.5" onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      )}
      {lead.serviceLines.length === 0 ? (
        <p className="text-sm text-muted">No service lines yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="text-muted text-left"><th className="th">Service</th><th className="th">Route</th><th className="th">Pax</th><th className="th text-right">Cost</th><th className="th text-right">Price</th><th className="th text-right">Margin</th></tr></thead>
          <tbody>
            {lead.serviceLines.map((s: any) => (
              <tr key={s.id} className="border-t border-gray-100">
                <td className="td">{s.serviceType}</td>
                <td className="td text-xs">{s.pickupLocation || "?"} → {s.dropoffLocation || "?"}</td>
                <td className="td">{s.passengerCount ?? "—"}</td>
                <td className="td text-right">{money(s.supplierCost, s.currency)}</td>
                <td className="td text-right">{money(s.customerPrice, s.currency)}</td>
                <td className="td text-right font-semibold">{s.margin != null ? `${s.margin}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

// ── Supplier broadcast ───────────────────────────────────────────────────────
function SupplierBroadcast({ lead, suppliers, reload }: { lead: any; suppliers: any[]; reload: () => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  const [method, setMethod] = useState("email");
  const [busy, setBusy] = useState(false);

  function toggle(id: number) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }
  async function broadcast() {
    if (picked.length === 0) return;
    setBusy(true);
    await apiSend(`/api/leads/${lead.id}/broadcast`, "POST", { supplierIds: picked, method });
    setBusy(false);
    setPicked([]);
    reload();
  }
  async function respond(reqId: number, body: any) {
    await apiSend(`/api/crud/supplierRequests/${reqId}`, "PATCH", body);
    reload();
  }

  const ranked = [...suppliers].sort((a, b) => (b.score || 0) - (a.score || 0));

  return (
    <Section title="Supplier quote requests">
      <div className="bg-surface rounded-lg p-3 mb-3">
        <div className="text-xs font-semibold text-muted uppercase mb-2">Broadcast to suppliers (ranked by score)</div>
        <div className="flex flex-wrap gap-2 mb-2 max-h-32 overflow-y-auto">
          {ranked.map((s) => (
            <button key={s.id} onClick={() => toggle(s.id)} className={`pill border ${picked.includes(s.id) ? "bg-brand-600 text-white border-brand-600" : "bg-white border-gray-200 text-ink2"}`}>
              {s.companyName} {s.score ? `· ${s.score.toFixed(0)}` : ""}
            </button>
          ))}
          {suppliers.length === 0 && <span className="text-sm text-muted">No suppliers — add some first.</span>}
        </div>
        <div className="flex items-center gap-2">
          <select className="select max-w-[140px] !py-1.5" value={method} onChange={(e) => setMethod(e.target.value)}>{REQUEST_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
          <button className="btn-primary !py-1.5" disabled={picked.length === 0 || busy} onClick={broadcast}>Send to {picked.length || ""} supplier(s)</button>
        </div>
      </div>

      {lead.supplierRequests.length === 0 ? (
        <p className="text-sm text-muted">No requests sent yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="text-muted text-left"><th className="th">Supplier</th><th className="th">Sent</th><th className="th">Resp</th><th className="th">Price</th><th className="th">Avail.</th><th className="th">Action</th></tr></thead>
          <tbody>
            {lead.supplierRequests.map((r: any) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="td">{r.supplier.companyName}</td>
                <td className="td text-xs">{fmtDateTime(r.sentAt)}</td>
                <td className="td text-xs">{r.respondedAt ? `${r.responseMins}m` : "—"}</td>
                <td className="td">{r.price != null ? money(r.price, r.currency) : "—"}</td>
                <td className="td"><Badge value={r.availability} /></td>
                <td className="td">
                  {!r.respondedAt ? (
                    <RespondInline onSubmit={(b) => respond(r.id, b)} />
                  ) : (
                    <select className="select !py-1 text-xs" value={r.outcome} onChange={(e) => respond(r.id, { outcome: e.target.value })}>
                      {["Pending", "Accepted", "Rejected"].map((o) => <option key={o}>{o}</option>)}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function RespondInline({ onSubmit }: { onSubmit: (b: any) => void }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [avail, setAvail] = useState("Available");
  if (!open) return <button className="text-brand-600 text-xs hover:underline" onClick={() => setOpen(true)}>Log response</button>;
  return (
    <div className="flex items-center gap-1">
      <input className="input !py-1 !px-2 w-20 text-xs" type="number" placeholder="Price" value={price} onChange={(e) => setPrice(e.target.value)} />
      <select className="select !py-1 !px-1 text-xs w-24" value={avail} onChange={(e) => setAvail(e.target.value)}>{["Available", "Unavailable", "Tentative"].map((a) => <option key={a}>{a}</option>)}</select>
      <button className="btn-primary !py-1 !px-2 text-xs" onClick={() => onSubmit({ respondedAt: new Date().toISOString(), price: price || null, availability: avail })}>✓</button>
    </div>
  );
}

// ── Quotes ───────────────────────────────────────────────────────────────────
function Quotes({ lead, reload }: { lead: any; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  async function build() {
    setBusy(true);
    try { await apiSend("/api/quotes/build", "POST", { leadId: lead.id }); reload(); }
    catch (e: any) { alert(e.message); }
    setBusy(false);
  }
  async function setStatus(qid: number, status: string) {
    const body: any = { status };
    if (status === "Sent") body.sentAt = new Date().toISOString();
    await apiSend(`/api/crud/quotes/${qid}`, "PATCH", body);
    reload();
  }
  const [converting, setConverting] = useState(false);
  async function convert(qid: number) {
    if (converting) return;
    if (!confirm("Record customer acceptance and create a provisional booking from this quote?")) return;
    setConverting(true);
    try {
      const r = await apiSend("/api/bookings/from-quote", "POST", { quoteId: qid });
      window.location.href = `/bookings/${r.booking.id}`;
    } catch (e: any) {
      alert(e.message);
      setConverting(false);
    }
  }

  return (
    <Section title="Quotes" action={<button className="btn-gold !py-1.5" disabled={busy} onClick={build}>Build quote from lines</button>}>
      {lead.quotes.length === 0 ? (
        <p className="text-sm text-muted">No quotes yet. Add service-line prices, then build a quote.</p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr className="text-muted text-left"><th className="th">Ref</th><th className="th">v</th><th className="th text-right">Cost</th><th className="th text-right">Price</th><th className="th text-right">Profit</th><th className="th">Status</th><th className="th">Actions</th></tr></thead>
          <tbody>
            {lead.quotes.map((q: any) => (
              <tr key={q.id} className="border-t border-gray-100">
                <td className="td font-medium">{q.quoteRef}</td>
                <td className="td">{q.version}</td>
                <td className="td text-right">{money(q.supplierCost, q.customerCurrency)}</td>
                <td className="td text-right">{money(q.customerPrice, q.customerCurrency)}</td>
                <td className="td text-right font-semibold text-green-700">{money(q.profit, q.customerCurrency)} <span className="text-muted text-xs">({q.margin}%)</span></td>
                <td className="td"><Badge value={q.status} /></td>
                <td className="td">
                  <div className="flex items-center gap-2">
                    <a className="text-brand-600 text-xs hover:underline" href={`/api/documents/quote/${q.id}`} target="_blank" rel="noreferrer">PDF</a>
                    {q.status === "Draft" && <button className="text-brand-600 text-xs hover:underline" onClick={() => setStatus(q.id, "Sent")}>Send</button>}
                    {q.status === "Sent" && <button className="text-green-700 text-xs hover:underline font-semibold disabled:opacity-50" disabled={converting} onClick={() => convert(q.id)}>Record acceptance</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

// ── Communications timeline ──────────────────────────────────────────────────
function Timeline({ lead, reload }: { lead: any; reload: () => void }) {
  const [channel, setChannel] = useState("Phone");
  const [direction, setDirection] = useState("Outbound");
  const [summary, setSummary] = useState("");

  async function add() {
    if (!summary.trim()) return;
    await apiSend("/api/crud/communications", "POST", { leadId: lead.id, channel, direction, summary });
    setSummary("");
    reload();
  }

  const items = [
    ...lead.communications.map((c: any) => ({ kind: "comm", at: c.occurredAt, ...c })),
    ...lead.callLogs.map((c: any) => ({ kind: "call", at: c.startedAt, ...c })),
    ...lead.noteEntries.map((n: any) => ({ kind: "note", at: n.createdAt, ...n })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <Section title="Communication timeline">
      <div className="bg-surface rounded-lg p-3 mb-3 flex flex-wrap items-center gap-2">
        <select className="select max-w-[130px] !py-1.5" value={channel} onChange={(e) => setChannel(e.target.value)}>{COMM_CHANNELS.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="select max-w-[120px] !py-1.5" value={direction} onChange={(e) => setDirection(e.target.value)}>{COMM_DIRECTIONS.map((c) => <option key={c}>{c}</option>)}</select>
        <input className="input flex-1 min-w-[160px] !py-1.5" placeholder="Log a call/message/note…" value={summary} onChange={(e) => setSummary(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn-primary !py-1.5" onClick={add}>Log</button>
      </div>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {items.length === 0 && <p className="text-sm text-muted">No activity yet.</p>}
        {items.map((it: any, i: number) => (
          <div key={i} className="flex gap-3 text-sm border-l-2 border-gray-200 pl-3 py-1">
            <span className="text-lg leading-none">{it.kind === "call" ? "📞" : it.kind === "note" ? "🗒" : it.channel === "WhatsApp" ? "💬" : it.channel === "Email" ? "✉️" : it.channel === "Supplier" ? "🏭" : "📌"}</span>
            <div className="flex-1">
              <div className="text-ink">{it.kind === "call" ? `${it.direction} call ${it.durationSecs ? `(${it.durationSecs}s)` : ""} ${it.status || ""}` : it.kind === "note" ? it.body : it.summary}</div>
              <div className="text-xs text-muted">{it.kind !== "note" && it.direction ? `${it.direction} · ` : ""}{it.user?.name || ""} · {fmtDateTime(it.at)}</div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── AI assistant panel ───────────────────────────────────────────────────────
const AI_TASKS: { task: string; label: string }[] = [
  { task: "summarise_lead", label: "Summarise lead" },
  { task: "draft_quote_email", label: "Draft quote email" },
  { task: "draft_whatsapp_reply", label: "Draft WhatsApp" },
  { task: "recommend_followup", label: "Recommend follow-up" },
  { task: "score_lead", label: "Score quality" },
  { task: "predict_conversion", label: "Predict conversion" },
  { task: "suggest_supplier", label: "Suggest supplier" },
];

function AiPanel({ leadId }: { leadId: number }) {
  const [out, setOut] = useState("");
  const [stub, setStub] = useState(false);
  const [busy, setBusy] = useState<string>("");

  async function run(task: string) {
    setBusy(task);
    const r = await apiSend("/api/ai", "POST", { task, leadId });
    setOut(r.text);
    setStub(r.stub);
    setBusy("");
  }

  return (
    <Section title="AI assistant">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {AI_TASKS.map((t) => (
          <button key={t.task} className="pill bg-brand-50 text-brand-700 border border-brand-100 hover:bg-brand-100 disabled:opacity-50" disabled={!!busy} onClick={() => run(t.task)}>
            {busy === t.task ? "…" : t.label}
          </button>
        ))}
      </div>
      {out && (
        <div>
          {stub && <div className="text-xs text-amber-600 mb-1">⚠ Stub output — connect Anthropic key (see SETUP-TASKS) for live AI.</div>}
          <textarea className="textarea text-sm" rows={10} value={out} onChange={(e) => setOut(e.target.value)} />
          <div className="text-xs text-muted mt-1">Editable before use — copy into your email/WhatsApp.</div>
        </div>
      )}
    </Section>
  );
}

function StatusHistory({ lead }: { lead: any }) {
  return (
    <Section title="Status history">
      <div className="space-y-2 max-h-72 overflow-y-auto text-sm">
        {lead.statusHistory.length === 0 && <p className="text-muted">No changes yet.</p>}
        {lead.statusHistory.map((h: any) => (
          <div key={h.id} className="flex items-center gap-2">
            <Badge value={h.toStatus} />
            <span className="text-xs text-muted">{h.fromStatus ? `from ${h.fromStatus} · ` : ""}{fmtDateTime(h.createdAt)}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}
