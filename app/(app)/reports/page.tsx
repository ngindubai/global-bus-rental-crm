"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet } from "@/lib/api";
import { KPI, PageHeader, Spinner } from "@/components/ui";
import { money } from "@/lib/ui";

const DIMENSIONS = [
  { key: "agent", label: "By agent" },
  { key: "country", label: "By country" },
  { key: "supplier", label: "By supplier" },
  { key: "booking", label: "By booking" },
];

export default function ReportsPage() {
  const [dimension, setDimension] = useState("agent");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ dimension, ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
    setData(await apiGet(`/api/reports?${qs}`));
    setLoading(false);
  }, [dimension, from, to]);

  useEffect(() => { load(); }, [load]);

  function exportCsv() {
    const qs = new URLSearchParams({ dimension, format: "csv", ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
    window.open(`/api/reports?${qs}`, "_blank");
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Profit Reports" subtitle="Revenue & margin by agent, country, supplier or booking">
        <button className="btn-secondary" onClick={exportCsv}>Export CSV</button>
      </PageHeader>

      <div className="flex flex-wrap items-end gap-2">
        <div><label className="label">Dimension</label><select className="select !py-1.5" value={dimension} onChange={(e) => setDimension(e.target.value)}>{DIMENSIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></div>
        <div><label className="label">From</label><input className="input !py-1.5" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input className="input !py-1.5" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      {loading || !data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <KPI label="Bookings" value={data.totals.bookings} />
            <KPI label="Revenue" value={money(data.totals.revenue)} />
            <KPI label="Profit" value={money(data.totals.profit)} tone="ok" />
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200"><tr>
                <th className="th">{DIMENSIONS.find((d) => d.key === dimension)?.label.replace("By ", "")}</th>
                <th className="th text-right">Bookings</th><th className="th text-right">Revenue</th>
                <th className="th text-right">Supplier cost</th><th className="th text-right">Profit</th><th className="th text-right">Margin</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {data.rows.length === 0 && <tr><td className="td text-muted" colSpan={6}>No data for this period.</td></tr>}
                {data.rows.map((r: any) => (
                  <tr key={r.key} className="hover:bg-gray-50">
                    <td className="td font-medium">{r.key}</td>
                    <td className="td text-right">{r.bookings}</td>
                    <td className="td text-right">{money(r.revenue)}</td>
                    <td className="td text-right">{money(r.supplierCost)}</td>
                    <td className="td text-right font-semibold text-green-700">{money(r.profit)}</td>
                    <td className="td text-right">{r.margin}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
