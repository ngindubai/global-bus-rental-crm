"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { list, apiGet, apiSend } from "@/lib/api";
import { Badge, PageHeader, Spinner, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/ui";
import { LEAD_STATUSES, LEAD_SOURCES, PRIORITIES, CUSTOMER_TYPES } from "@/lib/constants";

export default function LeadsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [refs, setRefs] = useState<{ countries: any[]; brands: any[] }>({ countries: [], brands: [] });

  async function load() {
    setLoading(true);
    const qs = [statusFilter ? `f_status=${encodeURIComponent(statusFilter)}` : "", search ? `search=${encodeURIComponent(search)}` : ""].filter(Boolean).join("&");
    const d = await list("leads", qs);
    setRows(d.items || []);
    setLoading(false);
  }

  useEffect(() => {
    load(); // eslint-disable-next-line
  }, [statusFilter]);
  useEffect(() => {
    Promise.all([list("countries", "take=500"), list("brands", "take=500")]).then(([c, b]) =>
      setRefs({ countries: c.items || [], brands: b.items || [] })
    );
  }, []);

  return (
    <div>
      <PageHeader title="Leads" subtitle="Lead pipeline — capture, assign, respond, quote">
        <button className="btn-primary" onClick={() => setShowNew(true)}>
          + New lead
        </button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select className="select max-w-[220px] !py-1.5" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          className="input max-w-xs !py-1.5"
          placeholder="Search name, phone, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button className="btn-secondary !py-1.5" onClick={load}>
          Search
        </button>
        <span className="text-sm text-muted ml-auto">{rows.length} leads</span>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty msg="No leads found." />
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="th">Ref</th>
                <th className="th">Customer</th>
                <th className="th">Trip</th>
                <th className="th">Travel</th>
                <th className="th">Source</th>
                <th className="th">Owner</th>
                <th className="th">Priority</th>
                <th className="th">Status</th>
                <th className="th">SLA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((l) => {
                const breached = l.slaBreached || (!l.firstResponseAt && l.slaDueAt && new Date(l.slaDueAt) < new Date());
                return (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="td">
                      <Link href={`/leads/${l.id}`} className="text-brand-600 font-semibold hover:underline">
                        {l.leadRef || l.id}
                      </Link>
                    </td>
                    <td className="td">
                      <div className="font-medium text-ink">{l.customerName}</div>
                      <div className="text-xs text-muted">{l.companyName || l.phone || l.email}</div>
                    </td>
                    <td className="td text-xs">{l.pickupLocation || "?"} → {l.dropoffLocation || "?"}</td>
                    <td className="td">{fmtDate(l.travelDate)}</td>
                    <td className="td text-xs">{l.source}</td>
                    <td className="td">{l.assignedTo?.name || <span className="text-amber-600">Unassigned</span>}</td>
                    <td className="td"><Badge value={l.priority} /></td>
                    <td className="td"><Badge value={l.status} /></td>
                    <td className="td">{breached ? <span className="pill bg-red-100 text-red-700">Breached</span> : l.firstResponseAt ? <span className="pill bg-green-100 text-green-700">Met</span> : <span className="pill bg-gray-100 text-gray-500">Open</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showNew && <NewLeadDrawer refs={refs} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

function NewLeadDrawer({ refs, onClose, onSaved }: { refs: any; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({ source: "Manual entry", priority: "Medium", customerType: "private" });
  const [error, setError] = useState("");
  const [dupWarn, setDupWarn] = useState(false);
  const set = (k: string, val: any) => setV((p: any) => ({ ...p, [k]: val }));

  async function submit(force = false) {
    setError("");
    try {
      await apiSend("/api/crud/leads", "POST", { ...v, _force: force });
      onSaved();
    } catch (e: any) {
      if (e.data?.duplicate) {
        setDupWarn(true);
        setError(e.message);
      } else setError(e.message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-canvas h-full overflow-y-auto shadow-cardlg">
        <div className="sticky top-0 bg-white border-b px-5 py-3 flex items-center justify-between z-10">
          <h2 className="text-lg">New lead</h2>
          <button className="btn-ghost !px-2" onClick={onClose}>✕</button>
        </div>
        <form className="p-5 grid grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
          <Group label="Customer name" req><input className="input" value={v.customerName || ""} onChange={(e) => set("customerName", e.target.value)} required /></Group>
          <Group label="Type"><select className="select" value={v.customerType} onChange={(e) => set("customerType", e.target.value)}>{CUSTOMER_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Group>
          <Group label="Company"><input className="input" value={v.companyName || ""} onChange={(e) => set("companyName", e.target.value)} /></Group>
          <Group label="Phone"><input className="input" value={v.phone || ""} onChange={(e) => set("phone", e.target.value)} /></Group>
          <Group label="WhatsApp"><input className="input" value={v.whatsapp || ""} onChange={(e) => set("whatsapp", e.target.value)} /></Group>
          <Group label="Email"><input className="input" type="email" value={v.email || ""} onChange={(e) => set("email", e.target.value)} /></Group>
          <Group label="Country"><select className="select" value={v.countryId || ""} onChange={(e) => set("countryId", e.target.value ? Number(e.target.value) : "")}><option value="">—</option>{refs.countries.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Group>
          <Group label="City"><input className="input" value={v.city || ""} onChange={(e) => set("city", e.target.value)} /></Group>
          <Group label="Pickup"><input className="input" value={v.pickupLocation || ""} onChange={(e) => set("pickupLocation", e.target.value)} /></Group>
          <Group label="Drop-off"><input className="input" value={v.dropoffLocation || ""} onChange={(e) => set("dropoffLocation", e.target.value)} /></Group>
          <Group label="Travel date"><input className="input" type="date" value={v.travelDate || ""} onChange={(e) => set("travelDate", e.target.value)} /></Group>
          <Group label="Travel time"><input className="input" value={v.travelTime || ""} onChange={(e) => set("travelTime", e.target.value)} /></Group>
          <Group label="Passengers"><input className="input" type="number" value={v.passengerCount || ""} onChange={(e) => set("passengerCount", e.target.value)} /></Group>
          <Group label="Luggage"><input className="input" value={v.luggageDetails || ""} onChange={(e) => set("luggageDetails", e.target.value)} /></Group>
          <Group label="Source"><select className="select" value={v.source} onChange={(e) => set("source", e.target.value)}>{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select></Group>
          <Group label="Brand"><select className="select" value={v.brandId || ""} onChange={(e) => set("brandId", e.target.value ? Number(e.target.value) : "")}><option value="">—</option>{refs.brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Group>
          <Group label="Priority"><select className="select" value={v.priority} onChange={(e) => set("priority", e.target.value)}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></Group>
          <Group label="Service requirements" full><textarea className="textarea" rows={2} value={v.serviceRequirements || ""} onChange={(e) => set("serviceRequirements", e.target.value)} /></Group>
          <Group label="Notes" full><textarea className="textarea" rows={2} value={v.notes || ""} onChange={(e) => set("notes", e.target.value)} /></Group>

          {error && <div className="col-span-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          <div className="col-span-2 flex gap-2 pt-1">
            {dupWarn ? (
              <button type="button" className="btn-gold" onClick={() => submit(true)}>Create anyway</button>
            ) : (
              <button type="submit" className="btn-primary">Create lead</button>
            )}
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Group({ label, children, req, full }: { label: string; children: React.ReactNode; req?: boolean; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : "col-span-1"}>
      <label className="label">{label}{req && <span className="text-red-500"> *</span>}</label>
      {children}
    </div>
  );
}
