# Implementation Report — Global Bus Rental CRM

Booking-workflow, finance-integrity and security work completed on branch
`claude/crm-prompt-fixes-estsvd` (the branch that deploys to Render), built on top
of the QA P0 commit `1447fd0`.

> **Scope note.** Production deploys `main` on Render. Schema changes are applied by
> **reviewed, version-controlled Prisma migrations** via `prisma migrate deploy` in a
> `preDeployCommand` — there is no `db push` and no `--accept-data-loss` anywhere. The
> upgrade is additive + lossless type-widening and preserves existing data (verified —
> see *Migration results* and *Deployment & rollback*). Because production was
> previously managed by `db push`, it must be **baselined once** before the first
> deploy (after a backup); the runbook is in *Deployment & rollback*.

## Implemented requirements

### 1. Security & dependencies
- **Next.js 14.2.35 → 15.5.21** — clears the high-severity RSC deserialization DoS,
  SSRF-via-websocket, image-optimizer and middleware advisories (all fixed
  `<15.5.16`). Transitive `sharp` (libvips CVEs) pinned to `0.35.3` and bundled
  `postcss` to `8.5.19` via npm `overrides`. **`npm audit --omit=dev` → 0
  vulnerabilities.** React stays 18.3 (Next 15 supports it).
- Migrated to Next 15 async request APIs (`await cookies()`, awaited route `params`).
- **Real ESLint config** (`next/core-web-vitals`) + `lint`/`typecheck` scripts;
  removed `eslint.ignoreDuringBuilds` so the production build no longer skips linting.
- **GitHub Actions CI** (`.github/workflows/ci.yml`) with a **PostgreSQL service**:
  install, prisma generate + validate, `migrate deploy` + drift check + double
  backfill (idempotency), lint, type check, tests, production
  build, and a `--audit-level=high` gate.
- **Zod** runtime validation on every command body with field-level errors
  (`lib/validation.ts`).
- **Mass assignment**: `agentId` (ownership) and the workflow `status` removed from
  the agent-writable generic-booking allowlist; ownership/lifecycle now move only
  through dedicated commands. Object-level auth preserved from the QA branch on every
  detail/update/delete path.

### 2–3. Independent facts + multi-leg structure
- `Booking.status` (one overloaded dropdown) replaced by orthogonal facts:
  `operationalStage` (PROVISIONAL/CONFIRMED/IN_SERVICE/COMPLETED/CANCELLED),
  `customerAcceptance` (NOT_RECORDED/ACCEPTED/WITHDRAWN), `financialClosure`
  (OPEN/RECONCILED), plus per-leg `supplierConfirmation`
  (UNASSIGNED/REQUESTED/HELD/ACCEPTED/DECLINED/CANCELLED). Customer/supplier payment
  states and travel readiness are **computed** (`lib/policy.ts`), never stored as a
  chosen value. Legacy `status` kept read-only for compatibility.
- **Optimistic concurrency** `version` on Booking, bumped on every guarded transition.
- **`BookingLeg`** model — one immutable commercial + itinerary snapshot per accepted
  quote item, with per-leg supplier, Decimal amounts, applied FX, supplier-confirmation
  state and operational driver/vehicle/pickup/emergency fields.

### 4. Customer acceptance as a first-class event
- `POST /api/quotes/:id/record-acceptance` — requires a Sent, unexpired quote with
  complete positive pricing; creates exactly one provisional booking + one leg per
  quote item in a single transaction; snapshots the accepted plan; unique
  `Booking.quoteId` + idempotency (repeat/concurrent returns the same booking);
  generates initial agent tasks; writes one correlated `BusinessEvent`; moves the
  lead to *Booking Provisional* (not Won/Confirmed). **Old `Convert`/`from-quote`
  removed.**

### 5. Manual supplier acceptance per leg
- `POST /api/bookings/:id/legs/:legId/record-supplier-acceptance` — `SupplierAcceptance`
  with contact, recorder, date/time, channel, agreed amount/currency/terms, hold
  expiry, evidence and the accepted offer. Kept strictly distinct from a supplier
  merely quoting a price.

### 6. Configurable payment plans
- `PaymentPlan` + `PaymentMilestone`: percentage deposit, fixed deposit, full payment,
  approved credit; milestones with due basis (acceptance/travel) + offset; a
  confirmation milestone. Snapshotted onto the booking at acceptance. Customer payment
  state and the confirmation condition are computed from posted receipts vs the plan.

### 7. Immutable payment workflow
- Ledger money is **Prisma `Decimal`**; the ledger is append-only.
- **Agent** customer receipts (`/api/payments/record`): positive amount, ISO currency,
  method, received date, reference, notes/evidence, **client idempotency key**; posts
  immediately, stays **Unreconciled** until finance matches it.
- **Finance-only** commands: `supplier-payment`, `refund`, `:id/reverse`
  (append-only correction referencing the original — the original row is never
  edited), `:id/reconcile`/unreconcile.
- Integrity: idempotency + duplicate-reference protection, positive-amount validation,
  currency validation, blocked missing FX, **prohibited overpayment** (manager/admin
  override + reason), original/booking/reporting amounts + FX rate + source + timestamp
  stored, Decimal arithmetic, unique constraints for concurrency safety. Stripe webhook
  idempotency preserved from the QA branch (Decimal-safe).

### 8. Supplier responses → pricing
- `POST /api/supplier-requests/:id/use-offer` — one command copies supplier, amount,
  currency and terms onto the service line, marks it priced and rejects competing
  offers; records the decision in activity. Replaces log-response → accept → retype-cost.

### 10–11. Workspace + automatic confirmation & readiness
- `GET /api/bookings/:id` returns the booking + legs + ledger + plan + tasks + events
  **plus** computed payment state, readiness (with reasons) and the single contextual
  next action.
- Booking page rebuilt around **readiness and the next action** (no status dropdown):
  header badges, summary KPIs (balances, required-now, **informational margin — never a
  blocker**), readiness reasons, and tabs for Overview, Itinerary & legs (per-leg
  supplier acceptance), Payments & reconciliation, Documents, Tasks, Activity.
  Responsive cards.
- `evaluateConfirmation` (single evaluator) auto-confirms only when customer
  acceptance + all required legs supplier-accepted + payment/credit condition hold;
  records why/when. Readiness: missing supplier acceptance is always a hard blocker;
  trip/driver detail hardens near travel; supplier payment follows due terms.

### 16. Completion
- `POST /api/bookings/:id/complete` — outcomes completed/no_show/cancelled/incident;
  financial closure still requires finance reconciliation.

## Schema / migration summary
New models: `BookingLeg`, `SupplierAcceptance`, `PaymentPlan`, `PaymentMilestone`,
`BookingRevision`, `BusinessEvent`. Extended: `Booking` (independent facts, version,
confirmation/completion/cancellation, plan link), `Payment` (Decimal money +
reporting amount, ledger `kind`, reversal chain, reason, reconciled-by, idempotency
key). A reviewable SQL artifact is in
`prisma/migrations/20260722000000_independent_facts_legs_decimal_ledger/migration.sql`.
`scripts/backfill.js` (idempotent) creates one leg per existing booking, maps legacy
status conservatively (never regressing), recomputes paid totals from the ledger and
classifies legacy payment rows.

## Migration results
Verified with `prisma migrate deploy` against **a fresh DB** and against **a copy of
the real production schema (`a72e645`) carrying edge-case data** (Postgres 16):
- Fresh DB: baseline + upgrade applied; `migrate diff` (DB vs `schema.prisma`) reported
  **no drift**.
- Production-sim (booking + a payment with NULL currency): `migrate resolve --applied`
  baseline → `migrate deploy` applied only the upgrade; `Payment.amount` became
  `numeric(14,2)` with `400.25` preserved; the NULL-currency guard defaulted safely; no
  DROP/TRUNCATE ran.
- Backfill: 1 booking updated, 1 leg created (`1000.50 GBP` preserved), 1 payment
  classified; **idempotent**
  (second run created 0 legs).

## Test / build / audit results
- **Unit + integration: 26 tests pass** (`finance`, `security`, `policy`, and
  real-Postgres `integration` covering auto-confirmation gating, ledger reversal
  netting without mutating history, and idempotency-key uniqueness; integration skips
  cleanly without a DB).
- **Type check**: clean. **Lint**: warnings only (no errors); build does not skip it.
- **Production build**: compiles successfully.
- **`npm audit --omit=dev`: 0 vulnerabilities.**
- **Live smoke test** (built server, Postgres): login; build → send → record-acceptance
  (+ idempotent repeat returns same booking); per-leg supplier acceptance; full receipt
  → **auto-confirmed**; overpayment blocked; negative/invalid-currency rejected with
  field errors; duplicate idempotency key deduped; admin override succeeds; agent
  denied supplier-payment and reverse (403).

## Deployment & rollback

**No `db push` and no `--accept-data-loss` anywhere.** Render config:
- `buildCommand`: `npm ci --include=dev && npx prisma generate && npm run build`
- `preDeployCommand`: `npx prisma migrate deploy && node scripts/backfill.js && npm run db:seed`
- `startCommand`: `npx next start -p $PORT` (start only starts the app)

`prisma/migrations/` holds a **baseline** (`20260101000000_baseline_production` = the
pre-existing production schema) and the **upgrade**
(`20260722120000_independent_facts_legs_decimal_ledger`). The upgrade is additive +
lossless type-widening (Float→Decimal), has **no** DROP/TRUNCATE of any data column,
and carries pre-flight guards (NULL `Payment.currency` → 'USD'; abort with a clear
message on duplicate `Booking.quoteId`).

### One-time production runbook (requires an operator with production access)
1. **Backup** the production Postgres (Render dashboard → database → *Backups* →
   *Create backup*, or `pg_dump`). Record the snapshot id. **Do not proceed without a
   verified backup.**
2. **Pre-flight checks** against the backup or a restored copy:
   `SELECT "quoteId", count(*) FROM "Booking" WHERE "quoteId" IS NOT NULL GROUP BY 1 HAVING count(*)>1;`
   (must be empty) and confirm row counts / payment totals by currency.
3. **Baseline** once (production has no `_prisma_migrations` table):
   `npx prisma migrate resolve --applied 20260101000000_baseline_production`
4. **Deploy** `main` — `preDeployCommand` runs `migrate deploy` (applies only the
   upgrade), then the idempotent backfill, then the safe seed. A pre-deploy failure
   aborts the release with the old instance still serving — no partial state.
5. **Verify** post-deploy: row/booking/payment counts unchanged, payment totals by
   currency unchanged, one `BookingLeg` per pre-existing booking, no orphaned FKs.

### Rehearsal performed here
Simulated the exact path on a copy of the **real production schema (`a72e645`)** with
edge-case data (a booking, a payment with NULL currency): baseline-resolve →
`migrate deploy` applied only the upgrade, `Payment.amount` became `numeric(14,2)` with
`400.25` preserved, the NULL-currency guard defaulted safely, backfill created exactly
one leg (`1000.50 GBP` preserved) and was idempotent on re-run. A fresh-DB
`migrate deploy` then a drift check (`migrate diff` DB vs schema) reported **no drift**.

### Rollback
Redeploy the previous commit. The upgrade is additive + type-widening, so the prior
code still reads the data (legacy `status` retained). To fully revert the schema,
restore the pre-deploy backup. No financial history is ever dropped.

## Remaining limitations / not fully implemented
Delivered as a coherent backend-complete core with a rebuilt booking workspace. The
following are scoped but not fully built in this pass and are safe follow-ups:
- **Booking/Quote/ServiceLine Float caches** were intentionally left as Float (the
  immutable **Payment ledger** is Decimal). Completing the Decimal conversion of the
  denormalized display caches is a follow-up (documented to keep the `db push` deploy
  lossless and bound the blast radius).
- Structured amendments (`BookingRevision` model exists) — apply/re-acceptance flow UI
  and endpoint not yet built.
- Autosave/recovery (section 15), configurable task-template engine beyond the initial
  acceptance tasks (section 14), customer/supplier history panels (section 12),
  quote-prep payment-plan builder UI, and Playwright E2E (section 17) are not yet built.
- CI is added but has not run on GitHub yet (no Actions history existed).
