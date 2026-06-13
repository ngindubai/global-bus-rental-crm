"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, list } from "@/lib/api";
import { PageHeader, Spinner, Empty } from "@/components/ui";
import { fmtDateTime } from "@/lib/ui";
import { ROLES } from "@/lib/constants";

export default function UsersPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [countries, setCountries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<null | any>(null);

  async function load() {
    const d = await apiGet("/api/users");
    setRows(d.items || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    list("countries", "take=500").then((d) => setCountries(d.items || []));
  }, []);

  return (
    <div>
      <PageHeader title="Users" subtitle="Staff accounts, roles & country specialisms">
        <button className="btn-primary" onClick={() => setDrawer({ role: "AGENT", active: true })}>+ New user</button>
      </PageHeader>
      <div className="card overflow-x-auto">
        {loading ? <Spinner /> : rows.length === 0 ? <Empty msg="No users." /> : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200"><tr>
              <th className="th">Name</th><th className="th">Email</th><th className="th">Role</th><th className="th">Country</th>
              <th className="th">Status</th><th className="th">Last seen</th><th className="th text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="td font-medium">{u.name}</td>
                  <td className="td">{u.email}</td>
                  <td className="td"><span className="pill bg-brand-50 text-brand-700">{u.role}</span></td>
                  <td className="td">{u.country?.name || "—"}</td>
                  <td className="td">{u.active ? <span className="pill bg-green-100 text-green-700">{u.online ? "Online" : "Active"}</span> : <span className="pill bg-gray-100 text-gray-500">Inactive</span>}</td>
                  <td className="td text-xs">{u.lastSeenAt ? fmtDateTime(u.lastSeenAt) : "—"}</td>
                  <td className="td text-right"><button className="text-brand-600 hover:underline text-sm" onClick={() => setDrawer(u)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {drawer && <UserDrawer user={drawer} countries={countries} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); load(); }} />}
    </div>
  );
}

function UserDrawer({ user, countries, onClose, onSaved }: { user: any; countries: any[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({ ...user });
  const [error, setError] = useState("");
  const set = (k: string, val: any) => setV((p: any) => ({ ...p, [k]: val }));

  async function save() {
    setError("");
    try {
      if (user.id) await apiSend("/api/users", "PATCH", v);
      else await apiSend("/api/users", "POST", v);
      onSaved();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-canvas h-full overflow-y-auto shadow-cardlg p-5 space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-lg">{user.id ? "Edit user" : "New user"}</h2><button className="btn-ghost !px-2" onClick={onClose}>✕</button></div>
        <div><label className="label">Name</label><input className="input" value={v.name || ""} onChange={(e) => set("name", e.target.value)} /></div>
        <div><label className="label">Email</label><input className="input" type="email" value={v.email || ""} onChange={(e) => set("email", e.target.value)} /></div>
        <div><label className="label">{user.id ? "New password (leave blank to keep)" : "Password"}</label><input className="input" type="password" value={v.password || ""} onChange={(e) => set("password", e.target.value)} /></div>
        <div><label className="label">Role</label><select className="select" value={v.role} onChange={(e) => set("role", e.target.value)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
        <div><label className="label">Phone</label><input className="input" value={v.phone || ""} onChange={(e) => set("phone", e.target.value)} /></div>
        <div><label className="label">Country specialism</label><select className="select" value={v.countryId || ""} onChange={(e) => set("countryId", e.target.value ? Number(e.target.value) : "")}><option value="">—</option>{countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!v.active} onChange={(e) => set("active", e.target.checked)} /> Active</label>
        {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex gap-2 pt-2"><button className="btn-primary" onClick={save}>Save</button><button className="btn-secondary" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}
