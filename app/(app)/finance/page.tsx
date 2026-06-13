"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { list } from "@/lib/api";
import { KPI, PageHeader, Spinner } from "@/components/ui";
import { Badge } from "@/components/ui";
import { fmtDate, money } from "@/lib/ui";

export default function FinancePage() {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    list("bookings", "take=500").then((d) => { setBookings(d.items || []); setLoading(false); });
  }, []);

  if (loading) return <Spinner />;

  const open = bookings.filter((b) => !["Cancelled", "Closed"].includes(b.status));
  const customerOutstanding = sum(open.map((b) => (b.customerInvoiceAmount || 0) - (b.customerPaidAmount || 0)));
  const supplierOutstanding = sum(open.map((b) => (b.supplierCost || 0) - (b.supplierPaidAmount || 0)));
  const totalProfit = sum(bookings.map((b) => b.grossProfit));
  const totalRevenue = sum(bookings.map((b) => b.customerInvoiceAmount));

  const custUnpaid = open.filter((b) => (b.customerPaidAmount || 0) < (b.customerInvoiceAmount || 0));
  const supUnpaid = open.filter((b) => (b.supplierPaidAmount || 0) < (b.supplierCost || 0));

  return (
    <div className="space-y-6">
      <PageHeader title="Finance" subtitle="Customer & supplier balances, profit" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Total revenue" value={money(totalRevenue)} />
        <KPI label="Gross profit" value={money(totalProfit)} tone="ok" />
        <KPI label="Customer outstanding" value={money(customerOutstanding)} tone="warn" />
        <KPI label="Supplier outstanding" value={money(supplierOutstanding)} tone="warn" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Table title="Unpaid customer bookings" rows={custUnpaid} amount={(b) => (b.customerInvoiceAmount || 0) - (b.customerPaidAmount || 0)} />
        <Table title="Suppliers unpaid" rows={supUnpaid} amount={(b) => (b.supplierCost || 0) - (b.supplierPaidAmount || 0)} />
      </div>
    </div>
  );
}

function Table({ title, rows, amount }: { title: string; rows: any[]; amount: (b: any) => number }) {
  return (
    <section className="card p-4">
      <h2 className="text-base font-bold mb-3">{title} <span className="text-muted font-normal text-sm">({rows.length})</span></h2>
      <table className="w-full text-sm">
        <thead><tr className="text-muted text-left"><th className="th">Ref</th><th className="th">Travel</th><th className="th">Status</th><th className="th text-right">Outstanding</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td className="td text-muted" colSpan={4}>Nothing outstanding ✓</td></tr>}
          {rows.map((b) => (
            <tr key={b.id} className="border-t border-gray-100">
              <td className="td"><Link href={`/bookings/${b.id}`} className="text-brand-600 hover:underline">{b.bookingRef}</Link></td>
              <td className="td">{fmtDate(b.travelDate)}</td>
              <td className="td"><Badge value={b.status} /></td>
              <td className="td text-right font-semibold text-amber-600">{money(amount(b), b.customerCurrency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function sum(a: (number | null | undefined)[]) {
  return Math.round(a.reduce((s: number, n) => s + (n || 0), 0) * 100) / 100;
}
