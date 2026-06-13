// Declarative field configs that drive the generic ResourcePage (list + form).
import {
  CURRENCIES, PRIORITIES, CUSTOMER_TYPES, SERVICE_TYPES, REQUEST_METHODS,
  QUOTE_STATUSES, BOOKING_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES,
  COMMISSION_STATUSES, ROLES, COMM_CHANNELS, COMM_DIRECTIONS,
} from "./constants";

export type Field = {
  name: string;
  label: string;
  type?: "text" | "number" | "money" | "date" | "datetime" | "select" | "textarea" | "checkbox" | "ref" | "email" | "tel";
  options?: string[];
  ref?: string; // resource for ref dropdown
  refLabel?: string; // label field on the ref'd record
  list?: boolean; // show as a table column
  form?: boolean; // show in the create/edit form
  required?: boolean;
  badge?: boolean; // render as status badge in the table
  currencyFrom?: string; // field name holding the currency for money formatting
  half?: boolean; // half-width in form grid
};

export type ResourceConfig = {
  title: string;
  resource: string;
  subtitle?: string;
  detailHref?: (row: any) => string; // makes the first column a link
  fields: Field[];
  defaultValues?: Record<string, any>;
};

const f = (name: string, label: string, extra: Partial<Field> = {}): Field => ({ name, label, list: true, form: true, ...extra });

export const CONFIGS: Record<string, ResourceConfig> = {
  customers: {
    title: "Customers",
    resource: "customers",
    subtitle: "Private & corporate customer records",
    fields: [
      f("name", "Name", { required: true, half: true }),
      f("customerType", "Type", { type: "select", options: CUSTOMER_TYPES, badge: true, half: true }),
      f("companyName", "Company", { half: true }),
      f("email", "Email", { type: "email", half: true }),
      f("phone", "Phone", { type: "tel", half: true }),
      f("whatsapp", "WhatsApp", { type: "tel", half: true }),
      f("countryId", "Country", { type: "ref", ref: "countries", refLabel: "name", list: false, half: true }),
      f("city", "City", { half: true }),
      f("vip", "VIP", { type: "checkbox", half: true }),
      f("notes", "Notes", { type: "textarea", list: false }),
    ],
  },

  suppliers: {
    title: "Suppliers",
    resource: "suppliers",
    subtitle: "Transport suppliers, inventory & scoring",
    fields: [
      f("companyName", "Company", { required: true, half: true }),
      f("contactPerson", "Contact", { half: true }),
      f("phone", "Phone", { type: "tel", half: true }),
      f("whatsapp", "WhatsApp", { type: "tel", list: false, half: true }),
      f("email", "Email", { type: "email", list: false, half: true }),
      f("countryId", "Country", { type: "ref", ref: "countries", refLabel: "name", list: false, half: true }),
      f("serviceAreas", "Service areas", { list: false }),
      f("currency", "Currency", { type: "select", options: CURRENCIES, half: true }),
      f("paymentTerms", "Payment terms", { list: false, half: true }),
      f("rating", "Rating (0-5)", { type: "number", half: true }),
      f("score", "Score", { type: "number", form: false }),
      f("avgResponseMins", "Avg resp (min)", { type: "number", form: false }),
      f("bankDetails", "Bank details", { type: "textarea", list: false }),
      f("notes", "Notes", { type: "textarea", list: false }),
      f("active", "Active", { type: "checkbox", half: true }),
    ],
    defaultValues: { currency: "USD", rating: 0, active: true },
  },

  quotes: {
    title: "Quotes",
    resource: "quotes",
    subtitle: "Customer quotes with profit & margin",
    detailHref: (r) => `/leads/${r.leadId}`,
    fields: [
      f("quoteRef", "Ref", { form: false }),
      f("leadId", "Lead", { type: "ref", ref: "leads", refLabel: "customerName", required: true, list: false }),
      f("customerCurrency", "Currency", { type: "select", options: CURRENCIES, half: true }),
      f("supplierCost", "Supplier cost", { type: "money", half: true }),
      f("customerPrice", "Customer price", { type: "money", half: true }),
      f("profit", "Profit", { type: "money", form: false }),
      f("margin", "Margin %", { type: "number", form: false }),
      f("validUntil", "Valid until", { type: "date" }),
      f("status", "Status", { type: "select", options: QUOTE_STATUSES, badge: true, half: true }),
      f("internalNotes", "Internal notes", { type: "textarea", list: false }),
    ],
    defaultValues: { customerCurrency: "USD", status: "Draft" },
  },

  commissions: {
    title: "Commissions",
    resource: "commissions",
    subtitle: "Manual agent commissions",
    fields: [
      f("bookingId", "Booking", { type: "ref", ref: "bookings", refLabel: "bookingRef", half: true }),
      f("agentId", "Agent", { type: "ref", ref: "users", refLabel: "name", required: true, half: true }),
      f("amount", "Amount", { type: "money", required: true, half: true }),
      f("currency", "Currency", { type: "select", options: CURRENCIES, half: true }),
      f("status", "Status", { type: "select", options: COMMISSION_STATUSES, badge: true, half: true }),
      f("paidDate", "Paid date", { type: "date", half: true, form: false }),
      f("notes", "Notes", { type: "textarea", list: false }),
    ],
    defaultValues: { currency: "USD", status: "pending" },
  },

  brands: {
    title: "Brands",
    resource: "brands",
    subtitle: "Per-website branding for quotes & invoices",
    fields: [
      f("name", "Brand", { required: true, half: true }),
      f("displayName", "Display name", { half: true }),
      f("websiteUrl", "Website", { list: false, half: true }),
      f("logoUrl", "Logo URL", { list: false, half: true }),
      f("primaryColor", "Primary colour", { list: false, half: true }),
      f("accentColor", "Accent colour", { list: false, half: true }),
      f("contactEmail", "Contact email", { type: "email", half: true }),
      f("contactPhone", "Contact phone", { type: "tel", half: true }),
      f("quoteFooter", "Quote footer", { type: "textarea", list: false }),
      f("invoiceFooter", "Invoice footer", { type: "textarea", list: false }),
      f("active", "Active", { type: "checkbox", half: true }),
    ],
    defaultValues: { active: true, primaryColor: "#0f5b68", accentColor: "#f5a623" },
  },

  countries: {
    title: "Countries",
    resource: "countries",
    subtitle: "Territories, currencies & country managers",
    fields: [
      f("name", "Country", { required: true, half: true }),
      f("isoCode", "ISO", { half: true }),
      f("currency", "Currency", { type: "select", options: CURRENCIES, half: true }),
      f("currencySymbol", "Symbol", { half: true, list: false }),
      f("timezone", "Timezone", { half: true }),
      f("managerId", "Country manager", { type: "ref", ref: "users", refLabel: "name", half: true }),
      f("languages", "Languages", { list: false, half: true }),
      f("vatNotes", "VAT/Tax notes", { type: "textarea", list: false }),
      f("notes", "Notes", { type: "textarea", list: false }),
      f("active", "Active", { type: "checkbox", half: true }),
    ],
    defaultValues: { active: true },
  },
};
