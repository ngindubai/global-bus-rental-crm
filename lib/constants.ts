// Shared enums / option lists for the Bus Rental CRM.

export const ROLES = ["ADMIN", "MANAGER", "AGENT", "FINANCE"] as const;

export const LEAD_SOURCES = [
  "Website form",
  "Phone (Vonage)",
  "WhatsApp",
  "Manual entry",
];

// Module 4 — full pipeline
export const LEAD_STATUSES = [
  "New Lead",
  "Assigned",
  "Contacted",
  "Awaiting Customer Information",
  "Supplier Quotes Requested",
  "Supplier Prices Received",
  "Quote Prepared",
  "Quote Sent",
  "Follow-Up Required",
  "Negotiation",
  "Awaiting Payment",
  "Won / Confirmed",
  "Lost",
  "Cancelled",
  "Duplicate / Invalid",
];

export const LEAD_OPEN_STATUSES = LEAD_STATUSES.filter(
  (s) => !["Won / Confirmed", "Lost", "Cancelled", "Duplicate / Invalid"].includes(s)
);

export const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

export const CUSTOMER_TYPES = ["private", "corporate"];

export const SERVICE_TYPES = [
  "Airport transfer",
  "Point-to-point transfer",
  "City tour",
  "Multi-day charter",
  "Shuttle service",
  "Event transport",
  "Corporate roadshow",
  "Other",
];

export const REQUEST_METHODS = ["phone", "whatsapp", "email"];

export const QUOTE_STATUSES = ["Draft", "Sent", "Accepted", "Rejected", "Expired", "Superseded"];

// Module 11
export const BOOKING_STATUSES = [
  "Awaiting Customer Payment",
  "Customer Paid",
  "Supplier Payment Pending",
  "Supplier Paid",
  "Supplier Confirmed",
  "Travel Scheduled",
  "Travel Completed",
  "Closed",
  "Cancelled",
];

export const PAYMENT_METHODS = ["Bank transfer", "Stripe payment link", "Cash"];
export const PAYMENT_STATUSES = ["Pending", "Paid", "Failed", "Refunded"];

export const COMM_CHANNELS = ["Phone", "WhatsApp", "Email", "Internal note", "Supplier"];
export const COMM_DIRECTIONS = ["Inbound", "Outbound"];

export const COMMISSION_STATUSES = ["pending", "approved", "paid"];

export const CURRENCIES = [
  "USD", "EUR", "GBP", "AED", "SAR", "QAR", "KWD", "BHD", "OMR",
  "INR", "PKR", "EGP", "TRY", "ZAR", "SGD", "AUD", "CAD", "CHF", "JPY", "CNY",
];

// Default SLA: minutes to first response by priority
export const SLA_MINUTES: Record<string, number> = {
  Urgent: 15,
  High: 30,
  Medium: 60,
  Low: 240,
};

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  AGENT: "Agent",
  FINANCE: "Finance",
};
