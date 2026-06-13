"use client";

import { statusColor } from "@/lib/ui";

export function Badge({ value, className = "" }: { value?: string | null; className?: string }) {
  if (!value) return <span className="text-gray-400">—</span>;
  return <span className={`badge ${statusColor(value)} ${className}`}>{value}</span>;
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
      <div>
        <h1 className="text-2xl">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Spinner() {
  return <div className="py-16 text-center text-muted text-sm">Loading…</div>;
}

export function Empty({ msg }: { msg: string }) {
  return <div className="py-16 text-center text-muted text-sm">{msg}</div>;
}

export function KPI({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "danger" | "warn" | "ok" }) {
  const valueClass = tone === "danger" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-green-600" : "text-ink";
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${valueClass}`}>{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}
