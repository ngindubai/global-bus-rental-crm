"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import { KPI, PageHeader, Spinner } from "@/components/ui";
import { money, fmtDate } from "@/lib/ui";

export default function Dashboard() {
  const [d, setD] = useState<any>(null);
  const [scanning, setScanning] = useState(false);

  async function load() {
    setD(await apiGet("/api/dashboard"));
  }
  useEffect(() => {
    load();
  }, []);

  async function scan() {
    setScanning(true);
    await apiSend("/api/alerts/scan", "POST");
    setScanning(false);
    load();
  }

  if (!d) return <Spinner />;
  const { live, sales, agents, countries, suppliers, finance } = d;

  return (
    <div className="space-y-6">
      <PageHeader title="Executive Dashboard" subtitle="Live operations, sales, performance & finance">
        <button className="btn-secondary" onClick={scan} disabled={scanning}>
          {scanning ? "Scanning…" : "Run alert scan"}
        </button>
      </PageHeader>

      {/* Live operations */}
      <section>
        <h2 className="text-sm font-bold text-muted uppercase tracking-wide mb-2">Live Operations</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <KPI label="New leads today" value={live.newLeadsToday} />
          <KPI label="Waiting for response" value={live.waitingResponse} tone={live.waitingResponse ? "warn" : undefined} />
          <KPI label="SLA breaches" value={live.slaBreaches} tone={live.slaBreaches ? "danger" : "ok"} />
          <KPI label="Missed calls" value={live.missedCalls} tone={live.missedCalls ? "warn" : undefined} />
          <KPI label="Outstanding quotes" value={live.outstandingQuotes} />
          <KPI label="Awaiting supplier" value={live.awaitingSupplier} />
          <KPI label="Awaiting customer" value={live.awaitingCustomer} />
          <KPI label="Bookings today" value={live.bookingsToday} />
          <KPI label="Bookings next 7d" value={live.bookingsNext7} />
          <KPI label="Open alerts" value={live.openAlerts} tone={live.openAlerts ? "danger" : "ok"} />
        </div>
      </section>

      {/* Sales */}
      <section>
        <h2 className="text-sm font-bold text-muted uppercase tracking-wide mb-2">Sales</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KPI label="Revenue today" value={money(sales.revenueToday)} />
          <KPI label="Revenue MTD" value={money(sales.revenueMonth)} />
          <KPI label="Profit today" value={money(sales.profitToday)} tone="ok" />
          <KPI label="Profit MTD" value={money(sales.profitMonth)} tone="ok" />
          <KPI label="Avg booking" value={money(sales.avgBookingValue)} />
          <KPI label="Conversion" value={`${sales.conversion}%`} hint={`${sales.wonThisMonth} won MTD`} />
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Agents */}
        <section className="card p-4">
          <h2 className="text-sm font-bold text-muted uppercase tracking-wide mb-3">Agent Performance (MTD)</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="th">Agent</th>
                <th className="th">Leads</th>
                <th className="th">Quotes</th>
                <th className="th">Won</th>
                <th className="th text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a: any) => (
                <tr key={a.id} className="border-t border-gray-100">
                  <td className="td">
                    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${a.online ? "bg-green-500" : "bg-gray-300"}`} />
                    {a.name}
                  </td>
                  <td className="td">{a.leadsHandled}</td>
                  <td className="td">{a.quotesSent}</td>
                  <td className="td">{a.bookingsWon}</td>
                  <td className="td text-right font-semibold">{money(a.profit)}</td>
                </tr>
              ))}
              {agents.length === 0 && <tr><td className="td text-muted" colSpan={5}>No agents yet.</td></tr>}
            </tbody>
          </table>
        </section>

        {/* Countries */}
        <section className="card p-4">
          <h2 className="text-sm font-bold text-muted uppercase tracking-wide mb-3">Country / Territory</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="th">Country</th>
                <th className="th">Leads</th>
                <th className="th text-right">Revenue</th>
                <th className="th text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {countries.map((c: any) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="td">{c.name}</td>
                  <td className="td">{c.leads}</td>
                  <td className="td text-right">{money(c.revenue)}</td>
                  <td className="td text-right font-semibold">{money(c.profit)}</td>
                </tr>
              ))}
              {countries.length === 0 && <tr><td className="td text-muted" colSpan={4}>No countries yet.</td></tr>}
            </tbody>
          </table>
        </section>

        {/* Suppliers */}
        <section className="card p-4">
          <h2 className="text-sm font-bold text-muted uppercase tracking-wide mb-3">Supplier Score Ranking</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="th">Supplier</th>
                <th className="th">Score</th>
                <th className="th">Avg resp</th>
                <th className="th text-right">Cancellations</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s: any) => (
                <tr key={s.id} className="border-t border-gray-100">
                  <td className="td">{s.companyName}</td>
                  <td className="td font-semibold">{s.score?.toFixed(1) ?? "—"}</td>
                  <td className="td">{s.avgResponseMins != null ? `${s.avgResponseMins}m` : "—"}</td>
                  <td className="td text-right">{s.cancellationCount}</td>
                </tr>
              ))}
              {suppliers.length === 0 && <tr><td className="td text-muted" colSpan={4}>No suppliers yet.</td></tr>}
            </tbody>
          </table>
        </section>

        {/* Finance */}
        <section className="card p-4">
          <h2 className="text-sm font-bold text-muted uppercase tracking-wide mb-3">Finance</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <KPI label="Customer outstanding" value={money(finance.customerOutstanding)} tone="warn" />
            <KPI label="Supplier outstanding" value={money(finance.supplierOutstanding)} tone="warn" />
          </div>
          <div className="text-xs font-semibold text-muted uppercase mb-1">Unpaid before travel (≤7d)</div>
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {finance.customerUnpaidSoon.map((b: any) => (
              <Link key={b.id} href={`/bookings/${b.id}`} className="flex justify-between text-sm hover:bg-gray-50 rounded px-2 py-1">
                <span className="text-red-600 font-medium">⚠ {b.ref} (customer)</span>
                <span>{money(b.due)} • {fmtDate(b.travelDate)}</span>
              </Link>
            ))}
            {finance.supplierUnpaidSoon.map((b: any) => (
              <Link key={"s" + b.id} href={`/bookings/${b.id}`} className="flex justify-between text-sm hover:bg-gray-50 rounded px-2 py-1">
                <span className="text-amber-600 font-medium">⚠ {b.ref} (supplier)</span>
                <span>{money(b.due)} • {fmtDate(b.travelDate)}</span>
              </Link>
            ))}
            {finance.customerUnpaidSoon.length === 0 && finance.supplierUnpaidSoon.length === 0 && (
              <div className="text-sm text-muted">All upcoming travel is paid. ✓</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
