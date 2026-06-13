"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, list } from "@/lib/api";
import { PageHeader, Spinner } from "@/components/ui";
import { fmtDateTime } from "@/lib/ui";

export default function AttendancePage() {
  const [me, setMe] = useState<any>(null);
  const [open, setOpen] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const a = await apiGet("/api/attendance");
    setOpen(a.open);
    setRows(a.rows || []);
  }
  useEffect(() => {
    apiGet("/api/auth/me").then((d) => setMe(d.user));
    load();
    apiGet("/api/users").then((d) => setTeam(d.items || [])).catch(() => {});
    setLoading(false);
  }, []);

  async function act(action: string) {
    await apiSend("/api/attendance", "POST", { action });
    load();
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <PageHeader title="Attendance & Monitoring" subtitle="Clock in/out, breaks, online status" />

      <section className="card p-5">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`pill ${open ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{open ? "● Clocked in" : "Clocked out"}</span>
          {open ? (
            <>
              <button className="btn-primary" onClick={() => act("out")}>Clock out</button>
              <button className="btn-secondary" onClick={() => act("break")}>+15m break</button>
              <span className="text-sm text-muted">Since {fmtDateTime(open.clockInAt)} · {open.breakMins}m break</span>
            </>
          ) : (
            <button className="btn-primary" onClick={() => act("in")}>Clock in</button>
          )}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="text-base font-bold mb-3">Today’s sessions</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-muted text-left"><th className="th">In</th><th className="th">Out</th><th className="th">Break</th><th className="th">IP</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td className="td text-muted" colSpan={4}>No sessions today.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="td">{fmtDateTime(r.clockInAt)}</td>
                <td className="td">{r.clockOutAt ? fmtDateTime(r.clockOutAt) : "—"}</td>
                <td className="td">{r.breakMins}m</td>
                <td className="td text-xs">{r.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {["ADMIN", "MANAGER"].includes(me?.role) && (
        <section className="card p-4">
          <h2 className="text-base font-bold mb-3">Team online status</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {team.map((u) => (
              <div key={u.id} className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2">
                <div><div className="text-sm font-medium">{u.name}</div><div className="text-xs text-muted">{u.role}</div></div>
                <span className={`pill ${u.online ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>{u.online ? "Online" : "Offline"}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
