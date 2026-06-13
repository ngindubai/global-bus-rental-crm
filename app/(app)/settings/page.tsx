"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { PageHeader, Spinner } from "@/components/ui";
import { CURRENCIES } from "@/lib/constants";

export default function SettingsPage() {
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [fx, setFx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [rate, setRate] = useState({ base: "USD", quote: "AED", rate: "" });

  async function load() {
    const [i, f] = await Promise.all([apiGet("/api/integrations/status"), apiGet("/api/fx")]);
    setIntegrations(i.integrations);
    setFx(f);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function saveRate() {
    if (!rate.rate) return;
    await apiSend("/api/fx", "POST", rate);
    setRate({ ...rate, rate: "" });
    load();
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Integrations & currency configuration" />

      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold">Integrations</h2>
          <a className="btn-secondary !py-1.5" href="/SETUP-TASKS.html" target="_blank" rel="noreferrer">Open setup guide ↗</a>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {integrations.map((i) => (
            <div key={i.key} className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-ink">{i.name}</div>
                <span className={`pill ${i.configured ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{i.configured ? "Live" : "Stub mode"}</span>
              </div>
              <div className="text-xs text-muted mt-1">{i.module}</div>
              <div className="text-sm text-ink2 mt-1">{i.desc}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted mt-3">Stub mode keeps every workflow usable without external accounts. Add keys in <code>.env</code> (see setup guide) to go live.</p>
      </section>

      <section className="card p-4">
        <h2 className="text-base font-bold mb-1">Currency</h2>
        <p className="text-sm text-muted mb-3">Base reporting currency: <strong>{fx.base}</strong> · Live FX: <strong>{fx.configured ? "active" : "manual only"}</strong></p>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div><label className="label">Base</label><select className="select !py-1.5" value={rate.base} onChange={(e) => setRate({ ...rate, base: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Quote</label><select className="select !py-1.5" value={rate.quote} onChange={(e) => setRate({ ...rate, quote: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Rate</label><input className="input !py-1.5 w-28" type="number" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} /></div>
          <button className="btn-primary !py-1.5" onClick={saveRate}>Set manual rate</button>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-muted text-left"><th className="th">Pair</th><th className="th text-right">Rate</th><th className="th">Source</th><th className="th">Updated</th></tr></thead>
          <tbody>
            {fx.rates.length === 0 && <tr><td className="td text-muted" colSpan={4}>No stored rates. Rates are fetched/cached as quotes are built.</td></tr>}
            {fx.rates.map((r: any) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="td">{r.base} → {r.quote}</td>
                <td className="td text-right">{r.rate}</td>
                <td className="td"><span className={`pill ${r.source === "manual" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>{r.source}</span></td>
                <td className="td text-xs">{new Date(r.fetchedAt).toLocaleString("en-GB")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
