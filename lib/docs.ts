import { fmtMoney } from "./currency";

type Brand = {
  name?: string | null;
  displayName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  quoteFooter?: string | null;
  invoiceFooter?: string | null;
};

type Row = { description: string; qty?: number; unit?: number | null; amount?: number | null };

export type DocSpec = {
  kind: "Quote" | "Invoice" | "Booking Confirmation" | "Receipt" | "Supplier Purchase Order";
  ref: string;
  date: string;
  validUntil?: string | null;
  brand?: Brand | null;
  party: { label: string; name: string; lines: string[] };
  meta: { label: string; value: string }[];
  rows: Row[];
  currency: string;
  total: number;
  paid?: number | null;
  footer?: string | null;
  notes?: string | null;
};

// Self-contained, print-ready HTML document. Brand colours + logo applied.
export function renderDocument(d: DocSpec): string {
  const primary = d.brand?.primaryColor || "#0f5b68";
  const accent = d.brand?.accentColor || "#f5a623";
  const company = d.brand?.displayName || d.brand?.name || "Global Bus Rental";
  const rowsHtml = d.rows
    .map(
      (r) => `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee">${esc(r.description)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center">${r.qty ?? 1}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right">${r.unit != null ? fmtMoney(r.unit, d.currency) : "—"}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right">${r.amount != null ? fmtMoney(r.amount, d.currency) : "—"}</td>
    </tr>`
    )
    .join("");

  const balance = d.paid != null ? d.total - d.paid : null;

  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>${d.kind} ${esc(d.ref)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Manrope,Segoe UI,system-ui,sans-serif;color:#16323a;margin:0;background:#f4f6f7}
  .sheet{max-width:820px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,.08)}
  .head{display:flex;justify-content:space-between;align-items:flex-start;padding:28px 32px;background:${primary};color:#fff}
  .logo{max-height:54px;margin-bottom:8px}
  .doc-title{font-size:26px;font-weight:800;letter-spacing:-.02em}
  .accent{color:${accent}}
  .body{padding:28px 32px}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}
  th{padding:10px 12px;text-align:left;background:#f1f5f6;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#5a6b70}
  .totals{margin-top:18px;margin-left:auto;width:280px;font-size:14px}
  .totals .line{display:flex;justify-content:space-between;padding:6px 0}
  .totals .grand{border-top:2px solid ${primary};font-weight:800;font-size:17px;padding-top:10px;margin-top:6px}
  .meta{display:flex;flex-wrap:wrap;gap:18px;margin:18px 0;font-size:13px}
  .meta div span{display:block;color:#7a8a8f;font-size:11px;text-transform:uppercase;letter-spacing:.03em}
  .party{font-size:14px;line-height:1.5}
  .footer{padding:18px 32px;border-top:1px solid #eee;color:#7a8a8f;font-size:12px;white-space:pre-wrap}
  .print-bar{max-width:820px;margin:0 auto;display:flex;gap:8px;justify-content:flex-end;padding:0 8px}
  .btn{background:${primary};color:#fff;border:0;border-radius:8px;padding:9px 16px;font-weight:700;cursor:pointer;font-family:inherit}
  @media print{.print-bar{display:none}body{background:#fff}.sheet{box-shadow:none;margin:0;border-radius:0}}
</style></head>
<body>
  <div class="print-bar"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
  <div class="sheet">
    <div class="head">
      <div>
        ${d.brand?.logoUrl ? `<img class="logo" src="${esc(d.brand.logoUrl)}"/>` : `<div style="font-size:20px;font-weight:800">${esc(company)}</div>`}
        <div style="opacity:.85;font-size:13px;margin-top:4px">${esc(d.brand?.contactEmail || "")} ${d.brand?.contactPhone ? "• " + esc(d.brand.contactPhone) : ""}</div>
      </div>
      <div style="text-align:right">
        <div class="doc-title">${d.kind}</div>
        <div style="opacity:.9;margin-top:4px">${esc(d.ref)}</div>
        <div style="opacity:.7;font-size:12px;margin-top:2px">${esc(d.date)}</div>
      </div>
    </div>
    <div class="body">
      <div class="party"><strong>${esc(d.party.label)}</strong><br/><strong style="font-size:16px">${esc(d.party.name)}</strong><br/>${d.party.lines.map(esc).join("<br/>")}</div>
      <div class="meta">${d.meta.map((m) => `<div><span>${esc(m.label)}</span>${esc(m.value)}</div>`).join("")}${
        d.validUntil ? `<div><span>Valid until</span>${esc(d.validUntil)}</div>` : ""
      }</div>
      <table>
        <thead><tr><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="totals">
        <div class="line"><span>Subtotal</span><span>${fmtMoney(d.total, d.currency)}</span></div>
        ${d.paid != null ? `<div class="line"><span>Paid</span><span>${fmtMoney(d.paid, d.currency)}</span></div>` : ""}
        <div class="line grand"><span>${balance != null ? "Balance due" : "Total"}</span><span>${fmtMoney(balance != null ? balance : d.total, d.currency)}</span></div>
      </div>
      ${d.notes ? `<div style="clear:both;margin-top:24px;font-size:13px;color:#54656a"><strong>Notes:</strong> ${esc(d.notes)}</div>` : ""}
    </div>
    <div class="footer">${esc(d.footer || `${company} — thank you for your business.`)}</div>
  </div>
</body></html>`;
}

function esc(s?: string | null) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
