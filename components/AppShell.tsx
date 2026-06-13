"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▦", roles: null },
  { href: "/leads", label: "Leads", icon: "🎯", roles: null },
  { href: "/bookings", label: "Bookings", icon: "🚌", roles: null },
  { href: "/calendar", label: "Calendar", icon: "🗓", roles: null },
  { href: "/quotes", label: "Quotes", icon: "📝", roles: null },
  { href: "/suppliers", label: "Suppliers", icon: "🏭", roles: null },
  { href: "/customers", label: "Customers", icon: "🤝", roles: null },
  { href: "/finance", label: "Finance", icon: "💳", roles: ["ADMIN", "MANAGER", "FINANCE"] },
  { href: "/commissions", label: "Commissions", icon: "💰", roles: ["ADMIN", "MANAGER", "FINANCE"] },
  { href: "/calls", label: "Calls", icon: "📞", roles: null },
  { href: "/attendance", label: "Attendance", icon: "⏱", roles: null },
  { href: "/reports", label: "Reports", icon: "📈", roles: ["ADMIN", "MANAGER", "FINANCE"] },
  { href: "/alerts", label: "Alerts", icon: "🚨", roles: null },
  { href: "/countries", label: "Countries", icon: "🌍", roles: ["ADMIN", "MANAGER"] },
  { href: "/brands", label: "Brands", icon: "🎨", roles: ["ADMIN", "MANAGER"] },
  { href: "/users", label: "Users", icon: "👥", roles: ["ADMIN", "MANAGER"] },
  { href: "/audit", label: "Audit Logs", icon: "🛡", roles: ["ADMIN", "MANAGER"] },
  { href: "/settings", label: "Settings", icon: "⚙", roles: null },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifs, setNotifs] = useState<{ items: any[]; unread: number }>({ items: [], unread: 0 });
  const [notifOpen, setNotifOpen] = useState(false);
  const [clockedIn, setClockedIn] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const searchTimer = useRef<any>(null);

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (r.ok) setUser((await r.json()).user);
      else router.push("/login");
    });
    const load = () => fetch("/api/notifications").then(async (r) => r.ok && setNotifs(await r.json()));
    load();
    fetch("/api/attendance").then(async (r) => r.ok && setClockedIn(!!(await r.json()).open));
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setResults([]);
    setQ("");
  }, [pathname]);

  function onSearch(v: string) {
    setQ(v);
    clearTimeout(searchTimer.current);
    if (v.trim().length < 2) return setResults([]);
    searchTimer.current = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(v)}`);
      if (r.ok) setResults((await r.json()).results);
    }, 300);
  }

  async function toggleClock() {
    const r = await fetch("/api/attendance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: clockedIn ? "out" : "in" }),
    });
    if (r.ok) setClockedIn(!clockedIn);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const nav = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));

  return (
    <div className="min-h-screen flex">
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-60 bg-brand-900 text-white flex flex-col transform transition-transform lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 py-5 border-b border-white/10">
          <div className="font-extrabold text-lg leading-tight tracking-tight">
            Global Bus<span className="text-gold-400"> Rental</span>
          </div>
          <div className="text-xs text-white/50 mt-0.5">Operations CRM</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          {nav.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-3 px-5 py-2 text-sm border-l-[3px] ${
                  active
                    ? "bg-white/10 text-white font-semibold border-gold-400"
                    : "text-white/60 border-transparent hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="w-5 text-center">{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>
        {user && (
          <div className="p-4 border-t border-white/10 text-sm">
            <div className="font-medium">{user.name}</div>
            <div className="text-xs text-white/50 mb-2">{user.role}</div>
            <div className="flex items-center gap-2">
              <button onClick={toggleClock} className={`pill ${clockedIn ? "bg-green-500/20 text-green-300" : "bg-white/10 text-white/70"}`}>
                {clockedIn ? "● Clocked in" : "Clock in"}
              </button>
              <button onClick={logout} className="text-xs text-white/70 hover:text-white underline ml-auto">
                Sign out
              </button>
            </div>
          </div>
        )}
      </aside>
      {mobileOpen && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-20">
          <button className="lg:hidden btn-secondary !px-2.5" onClick={() => setMobileOpen(true)}>
            ☰
          </button>
          <div className="relative flex-1 max-w-md">
            <input
              className="input !py-1.5"
              placeholder="Search leads, customers, bookings, suppliers…"
              value={q}
              onChange={(e) => onSearch(e.target.value)}
            />
            {results.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 card max-h-80 overflow-y-auto z-50">
                {results.map((r, i) => (
                  <Link key={i} href={r.href} className="block px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0">
                    <span className="badge bg-gray-100 text-gray-600 mr-2">{r.type}</span>
                    {r.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="relative ml-auto">
            <button
              className="btn-secondary !px-2.5 relative"
              onClick={async () => {
                setNotifOpen(!notifOpen);
                if (!notifOpen && notifs.unread > 0) {
                  await fetch("/api/notifications", { method: "PATCH" });
                  setNotifs({ ...notifs, unread: 0 });
                }
              }}
            >
              🔔
              {notifs.unread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {notifs.unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-full mt-1 w-80 card max-h-96 overflow-y-auto z-50">
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 border-b">Notifications</div>
                {notifs.items.length === 0 && <div className="px-3 py-4 text-sm text-gray-400">No notifications</div>}
                {notifs.items.map((n) => (
                  <Link key={n.id} href={n.link || "#"} className="block px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0" onClick={() => setNotifOpen(false)}>
                    <div className="text-sm font-medium">{n.title}</div>
                    {n.body && <div className="text-xs text-gray-500">{n.body}</div>}
                    <div className="text-[10px] text-gray-400">{new Date(n.createdAt).toLocaleString("en-GB")}</div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
