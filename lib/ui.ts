// Status → tailwind colour mapping for badges, shared across pages.

const GREEN = "bg-green-100 text-green-700";
const BLUE = "bg-blue-100 text-blue-700";
const AMBER = "bg-amber-100 text-amber-700";
const RED = "bg-red-100 text-red-700";
const GRAY = "bg-gray-100 text-gray-600";
const PURPLE = "bg-purple-100 text-purple-700";
const TEAL = "bg-brand-100 text-brand-700";

const MAP: Record<string, string> = {
  // lead pipeline
  "New Lead": GRAY,
  Assigned: BLUE,
  Contacted: BLUE,
  "Awaiting Customer Information": AMBER,
  "Supplier Quotes Requested": PURPLE,
  "Supplier Prices Received": PURPLE,
  "Quote Prepared": TEAL,
  "Quote Sent": TEAL,
  "Follow-Up Required": AMBER,
  Negotiation: AMBER,
  "Awaiting Payment": AMBER,
  "Won / Confirmed": GREEN,
  Lost: RED,
  Cancelled: RED,
  "Duplicate / Invalid": GRAY,
  // booking
  "Awaiting Customer Payment": AMBER,
  "Customer Paid": BLUE,
  "Supplier Payment Pending": AMBER,
  "Supplier Paid": BLUE,
  "Supplier Confirmed": PURPLE,
  "Travel Scheduled": TEAL,
  "Travel Completed": GREEN,
  Closed: GRAY,
  // quote
  Draft: GRAY,
  Sent: BLUE,
  Accepted: GREEN,
  Rejected: RED,
  Expired: GRAY,
  Superseded: GRAY,
  // payment / commission / generic
  Pending: AMBER,
  Paid: GREEN,
  Failed: RED,
  Refunded: GRAY,
  pending: AMBER,
  approved: BLUE,
  paid: GREEN,
  // priority
  Low: GRAY,
  Medium: BLUE,
  High: AMBER,
  Urgent: RED,
  // severity
  info: BLUE,
  warning: AMBER,
  critical: RED,
  // supplier outcome / availability
  Available: GREEN,
  Unavailable: RED,
  Tentative: AMBER,
};

export function statusColor(status?: string | null) {
  if (!status) return GRAY;
  return MAP[status] || GRAY;
}

export function fmtDate(d?: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB");
}
export function fmtDateTime(d?: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}
export function money(n?: number | string | null, currency = "USD") {
  if (n == null) return "—";
  // Prisma Decimal fields serialise to strings over JSON — coerce before formatting.
  const v = typeof n === "string" ? Number(n) : n;
  if (!isFinite(v)) return "—";
  try {
    // Always show minor units — rounding to whole numbers is unsafe for payment
    // reconciliation, where a few cents/pence must be visible (P2).
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}
