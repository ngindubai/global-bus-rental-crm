"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { list } from "@/lib/api";
import { Badge, PageHeader, Spinner, Empty } from "@/components/ui";
import { money } from "@/lib/ui";

export default function CalendarPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState("");
  const [supplier, setSupplier] = useState("");

  useEffect(() => {
    list("bookings", "take=500").then((d) => { setRows(d.items || []); setLoading(false); });
  }, []);

  const upcoming = rows
    .filter((b) => b.travelDate)
    .filter((b) => !agent || b.agent?.name === agent)
    .filter((b) => !supplier || b.supplier?.companyName === supplier)
    .sort((a, b) => new Date(a.travelDate).getTime() - new Date(b.travelDate).getTime());

  const byDate = new Map<string, any[]>();
  for (const b of upcoming) {
    const k = new Date(b.travelDate).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    byDate.set(k, [...(byDate.get(k) || []), b]);
  }

  const agents = Array.from(new Set(rows.map((b) => b.agent?.name).filter(Boolean)));
  const suppliers = Array.from(new Set(rows.map((b) => b.supplier?.companyName).filter(Boolean)));

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Booking Calendar" subtitle="Upcoming travel schedule" />
      <div className="flex flex-wrap gap-2 mb-4">
        <select className="select max-w-[180px] !py-1.5" value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">All agents</option>{agents.map((a) => <option key={a}>{a}</option>)}</select>
        <select className="select max-w-[180px] !py-1.5" value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">All suppliers</option>{suppliers.map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      {byDate.size === 0 ? <Empty msg="No scheduled travel." /> : (
        <div className="space-y-4">
          {Array.from(byDate.entries()).map(([date, items]) => (
            <div key={date}>
              <div className="text-sm font-bold text-brand-700 mb-2">{date}</div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((b) => {
                  const unpaid = (b.customerPaidAmount || 0) < (b.customerInvoiceAmount || 0);
                  return (
                    <Link key={b.id} href={`/bookings/${b.id}`} className="card p-3 hover:shadow-cardmd transition-shadow">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-ink">{b.bookingRef}</span>
                        <Badge value={b.status} />
                      </div>
                      <div className="text-sm mt-1">{b.travelTime || ""} · {b.pickupLocation || "?"} → {b.dropoffLocation || "?"}</div>
                      <div className="text-xs text-muted mt-1">{b.city || ""} · {b.supplier?.companyName || "No supplier"} · {b.agent?.name || "—"}</div>
                      <div className="text-xs mt-1">{money(b.customerInvoiceAmount, b.customerCurrency)} {unpaid ? <span className="text-red-600 font-semibold">· unpaid</span> : <span className="text-green-700">· paid</span>}</div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
