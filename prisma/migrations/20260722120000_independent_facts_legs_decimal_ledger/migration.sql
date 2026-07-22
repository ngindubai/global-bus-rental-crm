-- ─────────────────────────────────────────────────────────────────────────────
-- PRE-MIGRATION SAFETY GUARDS (hand-added). This migration is additive + lossless
-- type-widening (Float→Decimal, double→numeric preserves values), with NO DROP or
-- TRUNCATE of any data column. The guards below make the two operations that could
-- fail on real data fail EARLY and CLEARLY (inside the migration's transaction, so
-- nothing is half-applied) instead of with a cryptic constraint error:
--   1. Payment.currency becomes NOT NULL — default any legacy NULL to 'USD' first.
--   2. Booking.quoteId gains a UNIQUE index — abort with a clear message if the
--      legacy (non-idempotent) convert produced duplicate quoteIds, so an operator
--      can de-duplicate before retrying. No data is changed by the check.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "Payment" SET "currency" = 'USD' WHERE "currency" IS NULL;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT "quoteId" FROM "Booking"
    WHERE "quoteId" IS NOT NULL
    GROUP BY "quoteId" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate Booking.quoteId values found — resolve them before migrating (each accepted quote must map to one booking). See IMPLEMENTATION-REPORT.md → Migration.';
  END IF;
END
$guard$;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completionOutcome" TEXT,
ADD COLUMN     "confirmationReason" TEXT,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "customerAcceptance" TEXT NOT NULL DEFAULT 'NOT_RECORDED',
ADD COLUMN     "financialClosure" TEXT NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "operationalStage" TEXT NOT NULL DEFAULT 'PROVISIONAL',
ADD COLUMN     "paymentPlanId" INTEGER,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "fxSource" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'receipt',
ADD COLUMN     "providerEventId" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "reconciledById" INTEGER,
ADD COLUMN     "reportingAmount" DECIMAL(14,2),
ADD COLUMN     "reportingCurrency" TEXT,
ADD COLUMN     "reversalOfId" INTEGER,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "currency" SET NOT NULL,
ALTER COLUMN "baseAmount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "exchangeRate" SET DATA TYPE DECIMAL(18,8);

-- CreateTable
CREATE TABLE "BookingLeg" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "legIndex" INTEGER NOT NULL DEFAULT 1,
    "quoteItemId" INTEGER,
    "serviceLineId" INTEGER,
    "serviceType" TEXT,
    "serviceDate" TIMESTAMP(3),
    "serviceTime" TEXT,
    "timezone" TEXT,
    "pickupLocation" TEXT,
    "dropoffLocation" TEXT,
    "passengerCount" INTEGER,
    "vehicleRequirement" TEXT,
    "supplierId" INTEGER,
    "supplierAmount" DECIMAL(14,2),
    "supplierCurrency" TEXT DEFAULT 'USD',
    "customerAmount" DECIMAL(14,2),
    "customerCurrency" TEXT DEFAULT 'USD',
    "fxRate" DECIMAL(18,8),
    "supplierConfirmation" TEXT NOT NULL DEFAULT 'UNASSIGNED',
    "driverName" TEXT,
    "driverContact" TEXT,
    "vehicleType" TEXT,
    "vehicleCapacity" INTEGER,
    "vehicleRegistration" TEXT,
    "pickupInstructions" TEXT,
    "emergencyContact" TEXT,
    "readiness" TEXT NOT NULL DEFAULT 'BLOCKED',
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierAcceptance" (
    "id" SERIAL NOT NULL,
    "bookingLegId" INTEGER NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "supplierRequestId" INTEGER,
    "acceptingContact" TEXT,
    "recordedById" INTEGER,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL DEFAULT 'phone',
    "agreedAmount" DECIMAL(14,2) NOT NULL,
    "agreedCurrency" TEXT NOT NULL DEFAULT 'USD',
    "agreedTerms" TEXT,
    "holdExpiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "evidenceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentPlan" (
    "id" SERIAL NOT NULL,
    "quoteId" INTEGER,
    "planType" TEXT NOT NULL DEFAULT 'full_payment',
    "depositPercent" DECIMAL(6,3),
    "depositAmount" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "creditApproved" BOOLEAN NOT NULL DEFAULT false,
    "creditApprovedById" INTEGER,
    "creditTermsDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMilestone" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "dueBasis" TEXT NOT NULL DEFAULT 'acceptance',
    "dueOffsetDays" INTEGER NOT NULL DEFAULT 0,
    "isConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PaymentMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingRevision" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "revisionIndex" INTEGER NOT NULL DEFAULT 1,
    "changeType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "oldValues" TEXT,
    "newValues" TEXT,
    "requiresCustomerReacceptance" BOOLEAN NOT NULL DEFAULT false,
    "requiresSupplierReacceptance" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdById" INTEGER,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessEvent" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "bookingId" INTEGER,
    "correlationId" TEXT,
    "userId" INTEGER,
    "data" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingLeg_bookingId_idx" ON "BookingLeg"("bookingId");

-- CreateIndex
CREATE INDEX "BookingLeg_supplierId_supplierConfirmation_idx" ON "BookingLeg"("supplierId", "supplierConfirmation");

-- CreateIndex
CREATE INDEX "SupplierAcceptance_bookingLegId_idx" ON "SupplierAcceptance"("bookingLegId");

-- CreateIndex
CREATE INDEX "PaymentMilestone_planId_idx" ON "PaymentMilestone"("planId");

-- CreateIndex
CREATE INDEX "BookingRevision_bookingId_idx" ON "BookingRevision"("bookingId");

-- CreateIndex
CREATE INDEX "BusinessEvent_bookingId_idx" ON "BusinessEvent"("bookingId");

-- CreateIndex
CREATE INDEX "BusinessEvent_type_idx" ON "BusinessEvent"("type");

-- CreateIndex
CREATE INDEX "Lead_assignedToId_status_idx" ON "Lead"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_slaDueAt_idx" ON "Lead"("slaDueAt");

-- CreateIndex
CREATE INDEX "Quote_leadId_status_idx" ON "Quote"("leadId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_quoteId_key" ON "Booking"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_paymentPlanId_key" ON "Booking"("paymentPlanId");

-- CreateIndex
CREATE INDEX "Booking_agentId_operationalStage_idx" ON "Booking"("agentId", "operationalStage");

-- CreateIndex
CREATE INDEX "Booking_operationalStage_idx" ON "Booking"("operationalStage");

-- CreateIndex
CREATE INDEX "Booking_status_idx" ON "Booking"("status");

-- CreateIndex
CREATE INDEX "Booking_travelDate_idx" ON "Booking"("travelDate");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerEventId_key" ON "Payment"("providerEventId");

-- CreateIndex
CREATE INDEX "Payment_bookingId_status_idx" ON "Payment"("bookingId", "status");

-- CreateIndex
CREATE INDEX "Payment_bookingId_party_kind_idx" ON "Payment"("bookingId", "party", "kind");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_paymentPlanId_fkey" FOREIGN KEY ("paymentPlanId") REFERENCES "PaymentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLeg" ADD CONSTRAINT "BookingLeg_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLeg" ADD CONSTRAINT "BookingLeg_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAcceptance" ADD CONSTRAINT "SupplierAcceptance_bookingLegId_fkey" FOREIGN KEY ("bookingLegId") REFERENCES "BookingLeg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAcceptance" ADD CONSTRAINT "SupplierAcceptance_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAcceptance" ADD CONSTRAINT "SupplierAcceptance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMilestone" ADD CONSTRAINT "PaymentMilestone_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PaymentPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRevision" ADD CONSTRAINT "BookingRevision_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessEvent" ADD CONSTRAINT "BusinessEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

