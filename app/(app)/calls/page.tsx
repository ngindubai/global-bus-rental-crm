"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { list } from "@/lib/api";
import { Badge, PageHeader, Spinner, Empty } from "@/components/ui";
import { fmtDateTime } from "@/lib/ui";

export default function CallsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    list("callLogs", "take=300").then((d) => { setRows(d.items || []); setLoading(false); });
  }, []);

  return (
    <div>
      <PageHeader title="Call Logs" subtitle="Vonage call activity, matched to leads" />
      <div className="card overflow-x-auto">
        {loading ? <Spinner /> : rows.length === 0 ? (
          <Empty msg="No calls logged yet. Vonage webhooks post to /api/integrations/vonage/events." />
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200"><tr>
              <th className="th">When</th><th className="th">Direction</th><th className="th">From</th><th className="th">To</th>
              <th className="th">Duration</th><th className="th">Lead</th><th className="th">Recording</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="td text-xs">{fmtDateTime(c.startedAt)}</td>
                  <td className="td"><Badge value={c.direction === "missed" ? "Failed" : c.direction} className="capitalize" />{c.direction === "missed" && <span className="text-red-600 text-xs ml-1">missed</span>}</td>
                  <td className="td">{c.fromNumber || "—"}</td>
                  <td className="td">{c.toNumber || "—"}</td>
                  <td className="td">{c.durationSecs ? `${c.durationSecs}s` : "—"}</td>
                  <td className="td">{c.lead ? <Link href={`/leads/${c.leadId}`} className="text-brand-600 hover:underline">{c.lead.customerName}</Link> : "—"}</td>
                  <td className="td">{c.recordingUrl ? <a className="text-brand-600 hover:underline" href={c.recordingUrl} target="_blank" rel="noreferrer">▶ Play</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
