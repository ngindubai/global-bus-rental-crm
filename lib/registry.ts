// Maps API resource names to Prisma models + behaviour for the generic CRUD layer.

export type ResourceDef = {
  model: string; // prisma client property name
  softDelete?: boolean;
  search?: string[]; // string fields searched with `contains`
  include?: any;
  refPrefix?: string; // auto reference like L-2026-0001
  refField?: string;
  ownerScope?: string; // field restricting AGENT role to own records
  defaultOrder?: any;
};

export const RESOURCES: Record<string, ResourceDef> = {
  leads: {
    model: "lead",
    softDelete: true,
    search: ["customerName", "companyName", "email", "phone", "whatsapp", "leadRef", "pickupLocation", "dropoffLocation"],
    include: {
      assignedTo: { select: { id: true, name: true } },
      country: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      serviceLines: { select: { id: true } },
      quotes: { where: { deletedAt: null }, select: { id: true } },
    },
    refPrefix: "L",
    refField: "leadRef",
    ownerScope: "assignedToId",
    defaultOrder: { createdAt: "desc" },
  },
  customers: {
    model: "customer",
    softDelete: true,
    search: ["name", "companyName", "email", "phone", "whatsapp"],
    include: { country: false },
    defaultOrder: { createdAt: "desc" },
  },
  serviceLines: {
    model: "serviceLine",
    search: ["serviceType", "pickupLocation", "dropoffLocation"],
    include: {
      lead: { select: { id: true, customerName: true, leadRef: true } },
      supplier: { select: { id: true, companyName: true } },
    },
    defaultOrder: { createdAt: "asc" },
  },
  suppliers: {
    model: "supplier",
    softDelete: true,
    search: ["companyName", "contactPerson", "email", "phone", "serviceAreas"],
    include: {
      country: { select: { id: true, name: true } },
      inventory: true,
    },
    defaultOrder: { companyName: "asc" },
  },
  supplierVehicles: {
    model: "supplierVehicle",
    search: ["vehicleType"],
    include: { supplier: { select: { id: true, companyName: true } } },
    defaultOrder: { id: "asc" },
  },
  supplierRequests: {
    model: "supplierQuoteRequest",
    search: ["availability", "notes"],
    include: {
      supplier: { select: { id: true, companyName: true, avgResponseMins: true } },
      lead: { select: { id: true, customerName: true, leadRef: true } },
      serviceLine: { select: { id: true, serviceType: true } },
      requestedBy: { select: { id: true, name: true } },
    },
    defaultOrder: { sentAt: "desc" },
  },
  quotes: {
    model: "quote",
    softDelete: true,
    search: ["quoteRef", "internalNotes"],
    include: {
      lead: { select: { id: true, customerName: true, leadRef: true } },
      brand: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      items: true,
    },
    refPrefix: "Q",
    refField: "quoteRef",
    defaultOrder: { createdAt: "desc" },
  },
  bookings: {
    model: "booking",
    softDelete: true,
    search: ["bookingRef", "city", "pickupLocation", "dropoffLocation"],
    include: {
      lead: { select: { id: true, customerName: true, leadRef: true } },
      customer: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true } },
      supplier: { select: { id: true, companyName: true } },
      brand: { select: { id: true, name: true } },
    },
    refPrefix: "B",
    refField: "bookingRef",
    ownerScope: "agentId",
    defaultOrder: { travelDate: "asc" },
  },
  payments: {
    model: "payment",
    search: ["reference", "method", "notes"],
    include: {
      booking: { select: { id: true, bookingRef: true } },
      supplier: { select: { id: true, companyName: true } },
      recordedBy: { select: { id: true, name: true } },
    },
    defaultOrder: { createdAt: "desc" },
  },
  commissions: {
    model: "commission",
    softDelete: true,
    search: ["notes"],
    include: {
      booking: { select: { id: true, bookingRef: true } },
      agent: { select: { id: true, name: true } },
    },
    defaultOrder: { createdAt: "desc" },
  },
  suppliersPayments: { model: "payment", defaultOrder: { createdAt: "desc" } },
  communications: {
    model: "communication",
    search: ["summary"],
    include: { user: { select: { id: true, name: true } } },
    defaultOrder: { occurredAt: "desc" },
  },
  callLogs: {
    model: "callLog",
    search: ["fromNumber", "toNumber", "status"],
    include: {
      lead: { select: { id: true, customerName: true } },
      user: { select: { id: true, name: true } },
    },
    defaultOrder: { startedAt: "desc" },
  },
  tasks: {
    model: "task",
    softDelete: true,
    search: ["title", "description"],
    include: {
      lead: { select: { id: true, customerName: true } },
      assignedTo: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
    defaultOrder: { dueDate: "asc" },
  },
  notes: {
    model: "note",
    search: ["body"],
    include: { user: { select: { id: true, name: true } } },
    defaultOrder: { createdAt: "desc" },
  },
  brands: {
    model: "brand",
    softDelete: true,
    search: ["name", "displayName", "contactEmail"],
    defaultOrder: { name: "asc" },
  },
  countries: {
    model: "country",
    softDelete: true,
    search: ["name", "isoCode", "currency"],
    include: { manager: { select: { id: true, name: true } } },
    defaultOrder: { name: "asc" },
  },
  exchangeRates: {
    model: "exchangeRate",
    search: ["base", "quote"],
    defaultOrder: { base: "asc" },
  },
  attendance: {
    model: "attendance",
    search: [],
    include: { user: { select: { id: true, name: true } } },
    defaultOrder: { createdAt: "desc" },
  },
  alerts: {
    model: "alert",
    search: ["title", "body", "type"],
    defaultOrder: { createdAt: "desc" },
  },
  users: {
    model: "user",
    search: ["name", "email"],
    include: { country: { select: { id: true, name: true } } },
    defaultOrder: { name: "asc" },
  },
};

// fields parsed as numbers when coming from forms
export const NUMBER_FIELDS = new Set([
  "passengerCount", "supplierCost", "customerPrice", "margin", "profit", "exchangeRate",
  "customerInvoiceAmount", "customerPaidAmount", "supplierPaidAmount", "grossProfit",
  "amount", "baseAmount", "rate", "seats", "quantity", "qty", "version", "rating",
  "avgResponseMins", "acceptanceRate", "cancellationCount", "complaintCount", "score",
  "price", "responseMins", "durationSecs", "breakMins", "aiQualityScore", "aiConversionPct",
  "leadId", "customerId", "countryId", "brandId", "assignedToId", "supplierId",
  "serviceLineId", "quoteId", "bookingId", "agentId", "createdById", "approvedById",
  "managerId", "userId", "requestedById", "recordedById",
]);

export const DATE_FIELDS = new Set([
  "travelDate", "validUntil", "sentAt", "acceptedAt", "respondedAt", "paidAt",
  "paidDate", "dueDate", "nextFollowUpAt", "lastContactAt", "firstResponseAt",
  "slaDueAt", "assignedAt", "occurredAt", "completedAt", "clockInAt", "clockOutAt",
  "startedAt", "resolvedAt",
]);

export const BOOL_FIELDS = new Set(["active", "vip", "online", "success", "slaBreached"]);

export function coerceBody(body: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === "" || v === undefined) {
      out[k] = null;
      continue;
    }
    if (NUMBER_FIELDS.has(k)) out[k] = v === null ? null : Number(v);
    else if (DATE_FIELDS.has(k)) out[k] = v === null ? null : new Date(v);
    else if (BOOL_FIELDS.has(k)) out[k] = v === true || v === "true" || v === "1";
    else out[k] = v;
  }
  return out;
}

export function makeRef(prefix: string, id: number) {
  return `${prefix}-${new Date().getFullYear()}-${String(id).padStart(4, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MASS-ASSIGNMENT PROTECTION  (P0-03)
//
// The generic CRUD layer coerces a request body straight into Prisma, so without
// an allowlist any authenticated writer could set fields that are never offered
// in the UI — ownership, computed money/margin, paid amounts, audit stamps,
// reference numbers, supplier scores, etc. For every workflow/finance resource we
// pin the exact fields a form may write. Server-derived values (profit, margin,
// *PaidAmount, refs, scores, response times) are intentionally absent and can
// only change through their dedicated command paths.
//
// Resources NOT listed here are low-risk reference/support data (brands,
// countries, tasks, notes, communications, alerts, attendance, exchange rates)
// and keep the permissive behaviour.
// ─────────────────────────────────────────────────────────────────────────────
export const WRITABLE_FIELDS: Record<string, string[]> = {
  leads: [
    "source", "brandId", "sourceUrl", "campaignName", "customerId", "customerType",
    "customerName", "companyName", "phone", "whatsapp", "email", "countryId", "city",
    "timezone", "pickupLocation", "dropoffLocation", "travelDate", "travelTime",
    "passengerCount", "luggageDetails", "serviceRequirements", "notes", "status",
    "priority", "lostReason", "assignedToId", "nextFollowUpAt",
  ],
  serviceLines: [
    "leadId", "serviceType", "pickupLocation", "dropoffLocation", "travelDate",
    "travelTime", "passengerCount", "vehicleRequirement", "supplierId", "supplierCost",
    "customerPrice", "currency", "status", "notes",
  ],
  supplierRequests: [
    "leadId", "serviceLineId", "supplierId", "method", "respondedAt", "price",
    "currency", "availability", "notes", "outcome",
  ],
  quotes: [
    "leadId", "brandId", "customerCurrency", "supplierCurrency", "validUntil",
    "internalNotes", "status", "sentAt", "acceptedAt",
  ],
  // Bookings expose only operational/scheduling fields through generic CRUD.
  // All money — invoice/cost/paid amounts, profit, margin, FX — is owned by the
  // acceptance, payment-record and finance command endpoints, never a form.
  // Ownership (agentId) and the workflow lifecycle (operationalStage / customer
  // acceptance / financial closure) are NOT writable here: reassignment and every
  // state transition go through dedicated, authorised command endpoints so an
  // agent cannot reassign a booking to themselves or skip the workflow by editing
  // a field. `status` is the legacy display column, kept read-only during the
  // transition to the independent-facts model.
  bookings: [
    "notes", "travelTime", "pickupLocation", "dropoffLocation", "passengerCount", "city",
  ],
  suppliers: [
    "companyName", "contactPerson", "phone", "whatsapp", "email", "countryId",
    "serviceAreas", "bankDetails", "currency", "paymentTerms", "notes", "rating", "active",
  ],
  customers: [
    "customerType", "name", "companyName", "email", "phone", "whatsapp", "countryId",
    "city", "vip", "notes",
  ],
  commissions: ["bookingId", "agentId", "amount", "currency", "status", "notes"],
};

// Fields dropped for AGENT-role writers regardless of the allowlist above
// (sensitive data agents may not set/alter through generic CRUD).
export const AGENT_HIDDEN_FIELDS: Record<string, string[]> = {
  suppliers: ["bankDetails"],
};

// Resources whose rows are an append-only ledger or are managed exclusively by a
// dedicated route. Generic create/update/delete are rejected so writes must go
// through their audited command endpoints (payments → /api/payments/*,
// users → /api/users).
export const GENERIC_WRITE_BLOCKED = new Set(["payments", "suppliersPayments", "users"]);

// Apply the allowlist (and agent-specific hidden fields) to a coerced body.
export function filterWritable(resource: string, data: Record<string, any>, role: string) {
  const allow = WRITABLE_FIELDS[resource];
  let out = data;
  if (allow) {
    const set = new Set(allow);
    out = {};
    for (const [k, v] of Object.entries(data)) if (set.has(k)) out[k] = v;
  }
  const hidden = role === "AGENT" ? AGENT_HIDDEN_FIELDS[resource] : undefined;
  if (hidden) for (const f of hidden) delete out[f];
  return out;
}
