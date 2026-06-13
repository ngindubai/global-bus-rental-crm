"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { PageHeader, Spinner, Empty } from "@/components/ui";
import { fmtDateTime } from "@/lib/ui";

export default function AuditPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityType, setEntityType] = useState("");

  async function load() {
    setLoading(true);
    const d = await apiGet(`/api/audit${entityType ? `?entityType=${entityType}` : ""}`);
    setRows(d.items || []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [entityType]);

  return (
    <div>
      <PageHeader title="Audit Logs" subtitle="Every change, who & when" />
      <div className="flex items-center gap-2 mb-3">
        <select className="select max-w-[200px] !py-1.5" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          <option value="">All modules</option>
          {["leads", "quotes", "bookings", "payments", "suppliers", "supplierRequests", "commissions", "users", "brands", "countries"].map((t) => <option key={t}>{t}</option>)}
        </select>
        <span className="text-sm text-muted ml-auto">{rows.length} entries</span>
      </div>
      <div className="card overflow-x-auto">
        {loading ? <Spinner /> : rows.length === 0 ? <Empty msg="No activity logged." /> : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200"><tr>
              <th className="th">When</th><th className="th">User</th><th className="th">Action</th><th className="th">Module</th>
              <th className="th">Record</th><th className="th">Field</th><th className="th">Old → New</th><th className="th">IP</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="td text-xs">{fmtDateTime(a.createdAt)}</td>
                  <td className="td">{a.user?.name || "—"}</td>
                  <td className="td"><span className="pill bg-gray-100 text-gray-600">{a.action}</span></td>
                  <td className="td">{a.entityType}</td>
                  <td className="td">{a.entityId || "—"}</td>
                  <td className="td">{a.field || "—"}</td>
                  <td className="td text-xs max-w-[260px] truncate">{a.field ? `${a.oldValue ?? "∅"} → ${a.newValue ?? "∅"}` : "—"}</td>
                  <td className="td text-xs">{a.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
