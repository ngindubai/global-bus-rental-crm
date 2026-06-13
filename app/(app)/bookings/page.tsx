"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { list } from "@/lib/api";
import { Badge, PageHeader, Spinner, Empty } from "@/components/ui";
import { fmtDate, money } from "@/lib/ui";
import { BOOKING_STATUSES } from "@/lib/constants";

export default function BookingsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");

  async function load() {
    setLoading(true);
    const d = await list("bookings", status ? `f_status=${encodeURIComponent(status)}` : "");
    setRows(d.items || []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  return (
    <div>
      <PageHeader title="Bookings" subtitle="Confirmed trips, payment & travel status" />
      <div className="flex items-center gap-2 mb-3">
        <select className="select max-w-[230px] !py-1.5" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {BOOKING_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <span className="text-sm text-muted ml-auto">{rows.length} bookings</span>
      </div>
      <div className="card overflow-x-auto">
        {loading ? <Spinner /> : rows.length === 0 ? <Empty msg="No bookings yet." /> : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200"><tr>
              <th className="th">Ref</th><th className="th">Customer</th><th className="th">Trip</th><th className="th">Travel</th>
              <th className="th">Supplier</th><th className="th text-right">Invoice</th><th className="th text-right">Paid</th>
              <th className="th text-right">Profit</th><th className="th">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="td"><Link href={`/bookings/${b.id}`} className="text-brand-600 font-semibold hover:underline">{b.bookingRef || b.id}</Link></td>
                  <td className="td">{b.lead?.customerName || b.customer?.name || "—"}</td>
                  <td className="td text-xs">{b.pickupLocation || "?"} → {b.dropoffLocation || "?"}</td>
                  <td className="td">{fmtDate(b.travelDate)}</td>
                  <td className="td">{b.supplier?.companyName || "—"}</td>
                  <td className="td text-right">{money(b.customerInvoiceAmount, b.customerCurrency)}</td>
                  <td className="td text-right">{money(b.customerPaidAmount, b.customerCurrency)}</td>
                  <td className="td text-right font-semibold text-green-700">{money(b.grossProfit, b.customerCurrency)}</td>
                  <td className="td"><Badge value={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
