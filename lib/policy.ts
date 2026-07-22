// ─────────────────────────────────────────────────────────────────────────────
// Confirmation & travel-readiness policy — the single server-side evaluator.
//
// Booking state is NOT chosen by a user from a dropdown. It is DERIVED from facts:
//   • customer acceptance recorded,
//   • every required leg has a recorded supplier acceptance,
//   • the configured customer-payment milestone is satisfied (or credit approved).
// When all hold, a PROVISIONAL booking auto-confirms. Readiness is likewise
// computed from leg/driver/vehicle/payment facts with explicit reasons.
//
// Margin is informational only and NEVER blocks confirmation (business rule 9).
// ─────────────────────────────────────────────────────────────────────────────

type Tx = any; // Prisma client or transaction client

const EPS = 0.005; // money comparison tolerance (half a cent)

// ── Customer payment state ───────────────────────────────────────────────────
export type PaymentState = {
  state: "UNPAID" | "PARTIAL" | "DEPOSIT_MET" | "PAID_IN_FULL" | "CREDIT_APPROVED";
  paid: number;
  total: number;
  confirmationRequired: number; // amount needed to satisfy confirmation
  requiredNow: number; // amount currently due (max of past-due milestones)
  confirmationSatisfied: boolean;
};

export async function computePaymentState(tx: Tx, booking: any): Promise<PaymentState> {
  const total = Number(booking.customerInvoiceAmount || 0);
  const paid = Number(booking.customerPaidAmount || 0);

  const plan = booking.paymentPlanId
    ? await tx.paymentPlan.findUnique({ where: { id: booking.paymentPlanId }, include: { milestones: true } })
    : null;

  // Approved credit satisfies confirmation without an up-front receipt.
  if (plan && plan.planType === "approved_credit" && plan.creditApproved) {
    return {
      state: "CREDIT_APPROVED",
      paid,
      total,
      confirmationRequired: 0,
      requiredNow: 0,
      confirmationSatisfied: true,
    };
  }

  // The confirmation requirement: the confirmation milestone if the plan defines
  // one, else the deposit implied by the plan, else full payment.
  let confirmationRequired = total;
  if (plan) {
    const conf = (plan.milestones || []).find((m: any) => m.isConfirmation);
    if (conf) confirmationRequired = Number(conf.amount);
    else if (plan.planType === "percentage_deposit" && plan.depositPercent != null)
      confirmationRequired = Math.round(total * (Number(plan.depositPercent) / 100) * 100) / 100;
    else if (plan.planType === "fixed_deposit" && plan.depositAmount != null)
      confirmationRequired = Number(plan.depositAmount);
    else if (plan.planType === "full_payment") confirmationRequired = total;
  }

  // requiredNow: sum of milestone amounts already due (by date), minus paid; else
  // the confirmation requirement when no milestones exist.
  let requiredNow = Math.max(0, confirmationRequired - paid);
  if (plan && (plan.milestones || []).length) {
    const now = Date.now();
    let due = 0;
    for (const m of plan.milestones) {
      const basisDate = m.dueBasis === "travel" ? booking.travelDate : booking.createdAt;
      const dueAt = basisDate ? new Date(basisDate).getTime() + (m.dueOffsetDays || 0) * 86400000 : now;
      if (dueAt <= now) due += Number(m.amount);
    }
    requiredNow = Math.max(0, Math.round((due - paid) * 100) / 100);
  }

  const confirmationSatisfied = paid + EPS >= confirmationRequired;
  let state: PaymentState["state"] = "UNPAID";
  if (paid <= EPS) state = "UNPAID";
  else if (paid + EPS >= total) state = "PAID_IN_FULL";
  else if (confirmationSatisfied) state = "DEPOSIT_MET";
  else state = "PARTIAL";

  return { state, paid, total, confirmationRequired, requiredNow, confirmationSatisfied };
}

// ── Travel readiness ─────────────────────────────────────────────────────────
export type Readiness = { readiness: "BLOCKED" | "ATTENTION" | "READY"; blockers: string[]; warnings: string[] };

// Days before travel at which trip/driver/vehicle detail becomes a hard blocker.
const DETAIL_HARD_WINDOW_DAYS = 2;

export function computeReadiness(booking: any, legs: any[], paymentState: PaymentState): Readiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const activeLegs = (legs || []).filter((l) => !l.cancelledAt);
  if (activeLegs.length === 0) blockers.push("No itinerary legs on this booking.");

  const travelMs = booking.travelDate ? new Date(booking.travelDate).getTime() : null;
  const daysToTravel = travelMs != null ? (travelMs - Date.now()) / 86400000 : Infinity;
  const nearTravel = daysToTravel <= DETAIL_HARD_WINDOW_DAYS;

  for (const l of activeLegs) {
    const tag = `Leg ${l.legIndex}`;
    // Missing supplier acceptance is ALWAYS a hard blocker.
    if (l.supplierConfirmation !== "ACCEPTED") {
      blockers.push(`${tag}: supplier acceptance not recorded (${l.supplierConfirmation}).`);
    }
    // Essential trip/driver/vehicle details: warning far out, hard blocker near travel.
    const missing: string[] = [];
    if (!l.driverName) missing.push("driver name");
    if (!l.vehicleType && !l.vehicleRegistration) missing.push("vehicle details");
    if (!l.pickupInstructions) missing.push("pickup instructions");
    if (!l.emergencyContact) missing.push("emergency contact");
    if (missing.length) {
      const msg = `${tag}: missing ${missing.join(", ")}.`;
      if (nearTravel) blockers.push(msg);
      else warnings.push(msg);
    }
  }

  // Customer payment due by now.
  if (paymentState.requiredNow > EPS) {
    const msg = `Customer payment of ${paymentState.requiredNow.toFixed(2)} is due.`;
    if (nearTravel) blockers.push(msg);
    else warnings.push(msg);
  }

  // Unresolved amendments block readiness.
  if (booking._openRevisions) warnings.push("There are proposed amendments awaiting application.");

  const readiness = blockers.length ? "BLOCKED" : warnings.length ? "ATTENTION" : "READY";
  return { readiness, blockers, warnings };
}

// ── Automatic confirmation ───────────────────────────────────────────────────
// Idempotent: only promotes PROVISIONAL → CONFIRMED, records why/when, bumps the
// optimistic-concurrency version and appends a correlated business event. Call
// inside the same transaction as the fact that may have satisfied it.
export async function evaluateConfirmation(tx: Tx, bookingId: number, actorId?: number | null) {
  const booking = await tx.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { changed: false, reason: "not found" };
  if (booking.operationalStage !== "PROVISIONAL") return { changed: false, reason: `stage=${booking.operationalStage}` };
  if (booking.customerAcceptance !== "ACCEPTED") return { changed: false, reason: "customer not accepted" };

  const legs = await tx.bookingLeg.findMany({ where: { bookingId } });
  const activeLegs = legs.filter((l: any) => !l.cancelledAt);
  if (activeLegs.length === 0) return { changed: false, reason: "no legs" };
  const allSupplierAccepted = activeLegs.every((l: any) => l.supplierConfirmation === "ACCEPTED");
  if (!allSupplierAccepted) return { changed: false, reason: "supplier acceptance pending" };

  const ps = await computePaymentState(tx, booking);
  if (!ps.confirmationSatisfied) return { changed: false, reason: "payment/credit condition not met" };

  const reason = `Auto-confirmed: customer accepted, all ${activeLegs.length} leg(s) supplier-accepted, ${ps.state === "CREDIT_APPROVED" ? "approved credit active" : `payment ${ps.paid.toFixed(2)} ≥ required ${ps.confirmationRequired.toFixed(2)}`}.`;
  await tx.booking.update({
    where: { id: bookingId },
    data: {
      operationalStage: "CONFIRMED",
      confirmedAt: new Date(),
      confirmationReason: reason,
      status: "Supplier Confirmed", // keep legacy display column coherent
      version: { increment: 1 },
    },
  });
  await tx.businessEvent.create({
    data: { type: "confirmed", bookingId, userId: actorId ?? null, data: JSON.stringify({ reason }) },
  });
  return { changed: true, reason };
}
