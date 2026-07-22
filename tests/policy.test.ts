import { describe, it, expect } from "vitest";
import { computePaymentState, computeReadiness } from "@/lib/policy";

// A fake Prisma tx that resolves a payment plan (or none).
function tx(plan: any = null) {
  return { paymentPlan: { findUnique: async () => plan } } as any;
}

describe("computePaymentState", () => {
  it("with no plan, confirmation requires the full invoice", async () => {
    const b = { customerInvoiceAmount: 1000, customerPaidAmount: 300, paymentPlanId: null, createdAt: new Date() };
    const ps = await computePaymentState(tx(), b);
    expect(ps.confirmationRequired).toBe(1000);
    expect(ps.confirmationSatisfied).toBe(false);
    expect(ps.state).toBe("PARTIAL");
  });

  it("percentage-deposit plan is satisfied at the deposit, not the full amount", async () => {
    const b = { customerInvoiceAmount: 1000, customerPaidAmount: 300, paymentPlanId: 5, createdAt: new Date() };
    const plan = { planType: "percentage_deposit", depositPercent: 25, milestones: [] };
    const ps = await computePaymentState(tx(plan), b);
    expect(ps.confirmationRequired).toBe(250);
    expect(ps.confirmationSatisfied).toBe(true); // 300 >= 250
    expect(ps.state).toBe("DEPOSIT_MET");
  });

  it("approved credit satisfies confirmation with zero paid", async () => {
    const b = { customerInvoiceAmount: 1000, customerPaidAmount: 0, paymentPlanId: 5, createdAt: new Date() };
    const plan = { planType: "approved_credit", creditApproved: true, milestones: [] };
    const ps = await computePaymentState(tx(plan), b);
    expect(ps.state).toBe("CREDIT_APPROVED");
    expect(ps.confirmationSatisfied).toBe(true);
  });

  it("paid in full is reported as PAID_IN_FULL", async () => {
    const b = { customerInvoiceAmount: 1000, customerPaidAmount: 1000, paymentPlanId: null, createdAt: new Date() };
    const ps = await computePaymentState(tx(), b);
    expect(ps.state).toBe("PAID_IN_FULL");
  });
});

describe("computeReadiness", () => {
  const paidFull = { state: "PAID_IN_FULL", paid: 1000, total: 1000, confirmationRequired: 1000, requiredNow: 0, confirmationSatisfied: true } as const;

  it("is BLOCKED when a leg has no supplier acceptance", () => {
    const booking = { travelDate: new Date(Date.now() + 20 * 86400000) };
    const legs = [{ legIndex: 1, supplierConfirmation: "REQUESTED", driverName: "D", vehicleType: "Bus", pickupInstructions: "x", emergencyContact: "y" }];
    const r = computeReadiness(booking, legs, paidFull);
    expect(r.readiness).toBe("BLOCKED");
    expect(r.blockers.join(" ")).toMatch(/supplier acceptance/i);
  });

  it("is READY when supplier accepted and all details present, far from travel", () => {
    const booking = { travelDate: new Date(Date.now() + 20 * 86400000) };
    const legs = [{ legIndex: 1, supplierConfirmation: "ACCEPTED", driverName: "D", vehicleType: "Bus", pickupInstructions: "x", emergencyContact: "y" }];
    const r = computeReadiness(booking, legs, paidFull);
    expect(r.readiness).toBe("READY");
    expect(r.blockers).toHaveLength(0);
  });

  it("missing trip details are a warning far out but a hard blocker near travel", () => {
    const legs = [{ legIndex: 1, supplierConfirmation: "ACCEPTED", driverName: null, vehicleType: null, pickupInstructions: null, emergencyContact: null }];
    const farOut = computeReadiness({ travelDate: new Date(Date.now() + 20 * 86400000) }, legs, paidFull);
    expect(farOut.readiness).toBe("ATTENTION");
    const nearTravel = computeReadiness({ travelDate: new Date(Date.now() + 1 * 86400000) }, legs, paidFull);
    expect(nearTravel.readiness).toBe("BLOCKED");
  });
});
