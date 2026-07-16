import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { filterWritable, WRITABLE_FIELDS } from "@/lib/registry";
import { canAccessRecord } from "@/lib/auth";

// ── Mass-assignment protection (P0-03) ───────────────────────────────────────
describe("filterWritable — booking mass-assignment protection", () => {
  it("strips finance/derived fields an attacker might inject", () => {
    const malicious = {
      status: "Customer Paid",
      notes: "ok",
      customerPaidAmount: 999999, // must NOT be settable via a form
      supplierPaidAmount: 999999,
      grossProfit: 999999,
      customerInvoiceAmount: 0,
      agentId: 7,
      bookingRef: "B-HACK",
      quoteId: 42,
    };
    const out = filterWritable("bookings", malicious, "AGENT");
    expect(out).toEqual({ status: "Customer Paid", notes: "ok", agentId: 7 });
    expect(out).not.toHaveProperty("customerPaidAmount");
    expect(out).not.toHaveProperty("grossProfit");
    expect(out).not.toHaveProperty("customerInvoiceAmount");
    expect(out).not.toHaveProperty("bookingRef");
  });

  it("drops bankDetails for AGENT but keeps it for FINANCE on suppliers", () => {
    const body = { companyName: "X", bankDetails: "IBAN..." };
    expect(filterWritable("suppliers", { ...body }, "AGENT")).toEqual({ companyName: "X" });
    expect(filterWritable("suppliers", { ...body }, "FINANCE")).toEqual(body);
  });

  it("leaves unlisted low-risk resources untouched", () => {
    const body = { title: "t", anything: 1 };
    expect(filterWritable("tasks", { ...body }, "AGENT")).toEqual(body);
  });

  it("never lets a quote set its own money fields via generic CRUD", () => {
    const out = filterWritable("quotes", { status: "Sent", customerPrice: 5, profit: 5 }, "AGENT");
    expect(out).toEqual({ status: "Sent" });
    expect(WRITABLE_FIELDS.quotes).not.toContain("customerPrice");
  });
});

// ── Object-level authorisation (P0-02) ───────────────────────────────────────
describe("canAccessRecord", () => {
  const agent = { id: 3, name: "A", email: "a@x", role: "AGENT" };
  const manager = { id: 9, name: "M", email: "m@x", role: "MANAGER" };

  it("lets an agent access only their own scoped record", () => {
    expect(canAccessRecord(agent, { assignedToId: 3 }, "assignedToId")).toBe(true);
    expect(canAccessRecord(agent, { assignedToId: 4 }, "assignedToId")).toBe(false);
  });
  it("lets managers access any record", () => {
    expect(canAccessRecord(manager, { assignedToId: 4 }, "assignedToId")).toBe(true);
  });
  it("denies access to a missing record", () => {
    expect(canAccessRecord(agent, null, "assignedToId")).toBe(false);
  });
});

// ── Stripe webhook signature verification (P0-08) ─────────────────────────────
describe("verifyStripeSignature", () => {
  let verifyStripeSignature: (raw: string, sig?: string | null) => boolean;
  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
    ({ verifyStripeSignature } = await import("@/lib/integrations/stripe"));
  });

  function sign(raw: string, secret: string, t = Math.floor(Date.now() / 1000)) {
    const v1 = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
    return `t=${t},v1=${v1}`;
  }

  it("accepts a correctly signed, fresh payload", () => {
    const raw = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
    expect(verifyStripeSignature(raw, sign(raw, "whsec_test_secret"))).toBe(true);
  });
  it("rejects a tampered payload", () => {
    const raw = JSON.stringify({ id: "evt_1" });
    const header = sign(raw, "whsec_test_secret");
    expect(verifyStripeSignature(raw + "x", header)).toBe(false);
  });
  it("rejects a wrong secret", () => {
    const raw = JSON.stringify({ id: "evt_1" });
    expect(verifyStripeSignature(raw, sign(raw, "wrong_secret"))).toBe(false);
  });
  it("rejects a stale timestamp (replay)", () => {
    const raw = JSON.stringify({ id: "evt_1" });
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(verifyStripeSignature(raw, sign(raw, "whsec_test_secret", old))).toBe(false);
  });
  it("rejects a missing signature header", () => {
    expect(verifyStripeSignature("{}", null)).toBe(false);
  });
});
