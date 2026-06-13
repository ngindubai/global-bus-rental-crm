"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, list, update } from "@/lib/api";
import { Badge, PageHeader, Spinner, Empty } from "@/components/ui";
import { fmtDateTime } from "@/lib/ui";

export default function AlertsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  async function load() {
    const d = await list("alerts", "take=300");
    setRows((d.items || []).filter((a: any) => !a.resolvedAt));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function scan() {
    setScanning(true);
    await apiSend("/api/alerts/scan", "POST");
    setScanning(false);
    load();
  }
  async function resolve(id: number) {
    await update("alerts", id, { resolvedAt: new Date().toISOString() });
    load();
  }

  const linkFor = (a: any) => {
    if (a.entityType === "leads") return `/leads/${a.entityId}`;
    if (a.entityType === "bookings") return `/bookings/${a.entityId}`;
    return null;
  };

  return (
    <div>
      <PageHeader title="Alerts & Notifications" subtitle="Operational risks requiring attention">
        <button className="btn-primary" onClick={scan} disabled={scanning}>{scanning ? "Scanning…" : "Run scan"}</button>
      </PageHeader>
      {loading ? <Spinner /> : rows.length === 0 ? <Empty msg="No open alerts. Run a scan to refresh." /> : (
        <div className="space-y-2">
          {rows.map((a) => {
            const href = linkFor(a);
            return (
              <div key={a.id} className="card p-3 flex items-center gap-3">
                <Badge value={a.severity} />
                <div className="flex-1">
                  <div className="font-medium text-ink">{a.title}</div>
                  {a.body && <div className="text-sm text-muted">{a.body}</div>}
                  <div className="text-xs text-gray-400">{a.type} · {fmtDateTime(a.createdAt)}</div>
                </div>
                {href && <a className="btn-ghost !py-1.5" href={href}>Open</a>}
                <button className="btn-secondary !py-1.5" onClick={() => resolve(a.id)}>Resolve</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
