"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ResourceConfig, Field } from "@/lib/fields";
import { list, create, update, remove } from "@/lib/api";
import { Badge, PageHeader, Spinner, Empty } from "@/components/ui";
import { fmtDate, money } from "@/lib/ui";

export default function ResourcePage({ config, canEdit = true }: { config: ResourceConfig; canEdit?: boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState<null | any>(null);
  const [refData, setRefData] = useState<Record<string, any[]>>({});
  const [error, setError] = useState("");

  const cols = useMemo(() => config.fields.filter((f) => f.list), [config]);
  const formFields = useMemo(() => config.fields.filter((f) => f.form !== false), [config]);
  const refResources = useMemo(() => Array.from(new Set(config.fields.filter((f) => f.type === "ref" && f.ref).map((f) => f.ref!))), [config]);

  async function load() {
    setLoading(true);
    try {
      const data = await list(config.resource, search ? `search=${encodeURIComponent(search)}` : "");
      setRows(data.items || []);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    load(); // eslint-disable-next-line
  }, [config.resource]);

  useEffect(() => {
    refResources.forEach(async (res) => {
      try {
        const d = await list(res, "take=500");
        setRefData((prev) => ({ ...prev, [res]: d.items || [] }));
      } catch {}
    });
    // eslint-disable-next-line
  }, [refResources.join(",")]);

  function refLabelFor(field: Field, id: any) {
    const opts = refData[field.ref!] || [];
    const found = opts.find((o) => o.id === id);
    return found ? found[field.refLabel || "name"] || `#${id}` : id ? `#${id}` : "—";
  }

  function renderCell(field: Field, row: any) {
    const v = row[field.name];
    if (field.badge) return <Badge value={v} />;
    if (field.type === "ref") return refLabelFor(field, v);
    if (field.type === "money") return money(v, row.currency || row.customerCurrency || "USD");
    if (field.type === "date" || field.type === "datetime") return fmtDate(v);
    if (field.type === "checkbox") return v ? "✓" : "—";
    if (v == null || v === "") return <span className="text-gray-400">—</span>;
    return String(v);
  }

  async function save(values: any) {
    setError("");
    try {
      if (drawer?.id) await update(config.resource, drawer.id, values);
      else await create(config.resource, values);
      setDrawer(null);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function del(id: number) {
    if (!confirm("Delete this record?")) return;
    try {
      await remove(config.resource, id);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      <PageHeader title={config.title} subtitle={config.subtitle}>
        {canEdit && (
          <button className="btn-primary" onClick={() => setDrawer({ ...(config.defaultValues || {}) })}>
            + New
          </button>
        )}
      </PageHeader>

      <div className="flex items-center gap-2 mb-3">
        <input
          className="input max-w-xs !py-1.5"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button className="btn-secondary !py-1.5" onClick={load}>
          Search
        </button>
        <span className="text-sm text-muted ml-auto">{rows.length} records</span>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</div>}

      <div className="card overflow-x-auto">
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty msg="No records yet." />
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {cols.map((c) => (
                  <th key={c.name} className="th">
                    {c.label}
                  </th>
                ))}
                {canEdit && <th className="th text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  {cols.map((c, i) => (
                    <td key={c.name} className="td">
                      {i === 0 && config.detailHref ? (
                        <Link href={config.detailHref(row)} className="text-brand-600 font-semibold hover:underline">
                          {renderCell(c, row)}
                        </Link>
                      ) : (
                        renderCell(c, row)
                      )}
                    </td>
                  ))}
                  {canEdit && (
                    <td className="td text-right">
                      <button className="text-brand-600 hover:underline text-sm mr-3" onClick={() => setDrawer(row)}>
                        Edit
                      </button>
                      <button className="text-red-600 hover:underline text-sm" onClick={() => del(row.id)}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {drawer && (
        <EntityDrawer
          title={`${drawer.id ? "Edit" : "New"} ${config.title.replace(/s$/, "")}`}
          fields={formFields}
          initial={drawer}
          refData={refData}
          onClose={() => setDrawer(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

export function EntityDrawer({
  title,
  fields,
  initial,
  refData,
  onClose,
  onSave,
}: {
  title: string;
  fields: Field[];
  initial: any;
  refData: Record<string, any[]>;
  onClose: () => void;
  onSave: (v: any) => void;
}) {
  const [values, setValues] = useState<any>(() => {
    const v: any = {};
    fields.forEach((f) => {
      let val = initial[f.name];
      if (val instanceof Date) val = val.toISOString();
      if ((f.type === "date" || f.type === "datetime") && val) val = String(val).slice(0, f.type === "date" ? 10 : 16);
      v[f.name] = val ?? (f.type === "checkbox" ? false : "");
    });
    return v;
  });

  function set(name: string, value: any) {
    setValues((p: any) => ({ ...p, [name]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-canvas h-full overflow-y-auto shadow-cardlg">
        <div className="sticky top-0 bg-white border-b px-5 py-3 flex items-center justify-between z-10">
          <h2 className="text-lg">{title}</h2>
          <button className="btn-ghost !px-2" onClick={onClose}>
            ✕
          </button>
        </div>
        <form
          className="p-5 grid grid-cols-2 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(values);
          }}
        >
          {fields.map((f) => (
            <div key={f.name} className={f.half ? "col-span-1" : "col-span-2"}>
              <label className="label">
                {f.label}
                {f.required && <span className="text-red-500"> *</span>}
              </label>
              <FieldInput field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} refData={refData} />
            </div>
          ))}
          <div className="col-span-2 flex gap-2 pt-2">
            <button className="btn-primary" type="submit">
              Save
            </button>
            <button className="btn-secondary" type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange, refData }: { field: Field; value: any; onChange: (v: any) => void; refData: Record<string, any[]> }) {
  if (field.type === "textarea") return <textarea className="textarea" rows={3} value={value || ""} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === "checkbox")
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> Yes
      </label>
    );
  if (field.type === "select")
    return (
      <select className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={field.required}>
        <option value="">—</option>
        {(field.options || []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  if (field.type === "ref") {
    const opts = refData[field.ref!] || [];
    return (
      <select className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")} required={field.required}>
        <option value="">—</option>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o[field.refLabel || "name"] || `#${o.id}`}
          </option>
        ))}
      </select>
    );
  }
  const inputType = field.type === "money" || field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text";
  return (
    <input
      className="input"
      type={inputType}
      step={field.type === "money" || field.type === "number" ? "any" : undefined}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      required={field.required}
    />
  );
}
