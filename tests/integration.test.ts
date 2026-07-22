import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { recomputeBookingPaid } from "@/lib/payments";
import { evaluateConfirmation } from "@/lib/policy";

// Real-Postgres integration tests for the immutable ledger + confirmation policy.
// They run only when DATABASE_URL is set (CI provisions a Postgres service and runs
// `prisma db push` first); otherwise the whole suite is skipped so unit runs on a
// machine without a database stay green.
const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

let userId: number;
let supplierId: number;
const created: number[] = []; // booking ids to clean up

async function makeBooking(overrides: any = {}) {
  const b = await prisma.booking.create({
    data: {
      customerCurrency: "USD", supplierCurrency: "USD",
      customerInvoiceAmount: 1000, supplierCost: 700,
      operationalStage: "PROVISIONAL", customerAcceptance: "ACCEPTED", financialClosure: "OPEN",
      agentId: userId, ...overrides,
    },
  });
  created.push(b.id);
  const leg = await prisma.bookingLeg.create({
    data: {
      bookingId: b.id, legIndex: 1, supplierId, customerAmount: 1000, customerCurrency: "USD",
      supplierAmount: 700, supplierCurrency: "USD", supplierConfirmation: "REQUESTED",
      driverName: "D", vehicleType: "Coach", pickupInstructions: "Terminal 3", emergencyContact: "+100",
    },
  });
  return { booking: b, leg };
}

d("integration: immutable ledger + auto-confirmation", () => {
  beforeAll(async () => {
    const u = await prisma.user.create({ data: { name: "IT Agent", email: `it-${Date.now()}@test.local`, passwordHash: "x", role: "AGENT" } });
    userId = u.id;
    const s = await prisma.supplier.create({ data: { companyName: `IT Supplier ${Date.now()}` } });
    supplierId = s.id;
  });

  afterAll(async () => {
    for (const id of created) {
      await prisma.payment.deleteMany({ where: { bookingId: id } });
      await prisma.businessEvent.deleteMany({ where: { bookingId: id } });
      await prisma.supplierAcceptance.deleteMany({ where: { leg: { bookingId: id } } });
      await prisma.bookingLeg.deleteMany({ where: { bookingId: id } });
      await prisma.booking.delete({ where: { id } });
    }
    await prisma.supplier.delete({ where: { id: supplierId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("does not confirm until supplier accepted AND payment satisfied", async () => {
    const { booking, leg } = await makeBooking();

    // Full payment but supplier not yet accepted → NOT confirmed.
    await prisma.payment.create({ data: { bookingId: booking.id, party: "customer", direction: "in", kind: "receipt", amount: 1000, currency: "USD", status: "Paid", paidAt: new Date() } });
    await prisma.$transaction((tx) => recomputeBookingPaid(tx, booking.id));
    let r = await prisma.$transaction((tx) => evaluateConfirmation(tx, booking.id));
    expect(r.changed).toBe(false);
    expect((await prisma.booking.findUnique({ where: { id: booking.id } }))!.operationalStage).toBe("PROVISIONAL");

    // Record supplier acceptance → now all conditions met → auto-confirm.
    await prisma.bookingLeg.update({ where: { id: leg.id }, data: { supplierConfirmation: "ACCEPTED" } });
    r = await prisma.$transaction((tx) => evaluateConfirmation(tx, booking.id));
    expect(r.changed).toBe(true);
    const after = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(after!.operationalStage).toBe("CONFIRMED");
    expect(after!.confirmedAt).toBeTruthy();
    expect(after!.version).toBe(booking.version + 1);
  });

  it("recomputes paid totals from the ledger and nets reversals", async () => {
    const { booking } = await makeBooking();
    const p = await prisma.payment.create({ data: { bookingId: booking.id, party: "customer", direction: "in", kind: "receipt", amount: 400, currency: "USD", status: "Paid", paidAt: new Date() } });
    await prisma.$transaction((tx) => recomputeBookingPaid(tx, booking.id));
    expect(Number((await prisma.booking.findUnique({ where: { id: booking.id } }))!.customerPaidAmount)).toBe(400);

    // Append a reversal (original row untouched) → paid nets to 0.
    await prisma.payment.create({ data: { bookingId: booking.id, party: "customer", direction: "out", kind: "reversal", reversalOfId: p.id, amount: 400, currency: "USD", status: "Paid", paidAt: new Date() } });
    await prisma.$transaction((tx) => recomputeBookingPaid(tx, booking.id));
    expect(Number((await prisma.booking.findUnique({ where: { id: booking.id } }))!.customerPaidAmount)).toBe(0);
    // The original receipt row is still present and unmodified (immutable history).
    const orig = await prisma.payment.findUnique({ where: { id: p.id } });
    expect(Number(orig!.amount)).toBe(400);
  });

  it("enforces the unique idempotency key on the ledger", async () => {
    const { booking } = await makeBooking();
    const key = `idem-${Date.now()}`;
    await prisma.payment.create({ data: { bookingId: booking.id, party: "customer", direction: "in", kind: "receipt", amount: 100, currency: "USD", status: "Paid", idempotencyKey: key } });
    await expect(
      prisma.payment.create({ data: { bookingId: booking.id, party: "customer", direction: "in", kind: "receipt", amount: 100, currency: "USD", status: "Paid", idempotencyKey: key } })
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
