# Global Bus Rental — CRM (Phase 1)

Responsive web CRM & operations platform for passenger-transport enquiries: lead → supplier quoting → branded quotes → bookings → payments → profit reporting, with staff monitoring, an executive dashboard, and AI assistance.

**Stack:** Next.js 15 (App Router) · Prisma · PostgreSQL · Tailwind · JWT auth · Zod.

## Booking workflow & roles

The **sales agent owns a booking end-to-end** — enquiry, supplier coordination,
customer receipts, travel readiness and completion. There is no operations handoff.
**Finance** owns reconciliation, supplier payments, refunds, reversals and ledger
corrections.

Single-leg happy path:

```
Enquiry → Supplier pricing → Select offer (Use this offer) → Send quote →
Record customer acceptance → Provisional booking → Supplier acceptance (per leg) +
payment rule satisfied → CONFIRMED (automatic) → Travel Ready → Completed → Reconciled
```

Booking state is **not** a dropdown. It is independent facts: `operationalStage`,
`customerAcceptance`, per-leg `supplierConfirmation`, computed customer/supplier
payment state, computed travel readiness, and `financialClosure`. A provisional
booking **auto-confirms** only when the customer has accepted, every required leg has
recorded supplier acceptance, and the configured payment milestone (or approved
credit) is satisfied. Margin is shown for information and **never** blocks confirmation.

Every workflow/finance/acceptance action is a strictly-validated command endpoint
(`/api/quotes/:id/record-acceptance`, `/api/bookings/:id/legs/:legId/record-supplier-acceptance`,
`/api/supplier-requests/:id/use-offer`, `/api/payments/record`,
`/api/payments/supplier-payment`, `/api/payments/refund`, `/api/payments/:id/reverse`,
`/api/payments/:id/reconcile`, `/api/bookings/:id/complete`) — never generic CRUD. The
money ledger is append-only Prisma `Decimal`; mistakes are corrected by an appended
reversal/correction with a reason, never by editing history.

## Migrations

The schema uses independent booking facts, `BookingLeg`, `PaymentPlan`/`PaymentMilestone`,
`SupplierAcceptance`, `BookingRevision`, `BusinessEvent` and a Decimal payment ledger.
On deploy, Render runs `prisma db push --accept-data-loss` (required only for the
lossless Float→Decimal money cast) then `scripts/backfill.js` (idempotent: one leg per
existing booking, conservative legacy-status mapping, paid totals recomputed from the
ledger). A reviewable SQL migration is in `prisma/migrations/`. Locally: `npm run
db:backfill` after `db:push`. See `IMPLEMENTATION-REPORT.md` for the safe
`migrate deploy` hardening path.

## Local test / quality commands

```bash
npm run lint        # ESLint (next/core-web-vitals); also runs during build
npm run typecheck   # tsc --noEmit
npm test            # Vitest — unit + (with DATABASE_URL) real-Postgres integration
npm run build       # production build (fails on type/lint errors)
npm audit --omit=dev --audit-level=high   # must be clean
```

CI (`.github/workflows/ci.yml`) runs all of the above against a PostgreSQL service.

## Quick start (local) — no Docker

A real PostgreSQL server runs as a plain Node process (`embedded-postgres`) — no Docker, no install, no admin rights.

```bash
npm install
npm run db:up      # start Postgres on :5433 — LEAVE THIS TERMINAL RUNNING
# in a second terminal:
npm run db:push    # create tables
npm run db:seed    # sample data + admin user
npm run dev        # http://localhost:3200
```

Data lives in `.pgdata/` (git-ignored). The cluster is created UTF8 so non-Latin
text (Arabic names, etc.) stores cleanly.

### Logging in

`npm run db:seed` provisions a single administrator. Set `INITIAL_ADMIN_EMAIL`
and `INITIAL_ADMIN_PASSWORD` in your environment first; if `INITIAL_ADMIN_PASSWORD`
is left unset the seed generates a random password and prints it **once** to the
console — copy it, sign in, and change it under **Users**.

Local sample data (demo leads, bookings, suppliers, and the manager/agent/finance
demo accounts) is only created when `SEED_SAMPLE_DATA=true` (the default outside
production). Those demo accounts and passwords exist for local development only and
are never seeded in production.

## Integrations

Everything runs in safe **stub mode** with no external accounts. Open **Settings → Integrations** (or `/SETUP-TASKS.html`) for click-by-click setup of Vonage, Stripe, live FX, and Claude AI, with cost estimates. Each adapter auto-detects its key in `.env`.

| Adapter | Env keys | Module |
|---|---|---|
| Vonage voice | `VONAGE_*` | Calls (17) |
| Stripe | `STRIPE_*` | Finance (13) |
| FX rates | `FX_API_KEY` | Currency (14) |
| Claude AI | `ANTHROPIC_API_KEY` | AI (22) |

## Architecture

- `prisma/schema.prisma` — full domain model (leads, service lines, suppliers + inventory + scoring, supplier broadcast, quotes, bookings, payments, commissions, brands, countries, customers, comms, calls, attendance, audit, alerts, FX).
- `lib/` — `auth` (roles ADMIN/MANAGER/AGENT/FINANCE + audit/notify/alerts), `registry` (generic CRUD config), `assign` (round-robin + SLA), `scoring` (suppliers), `currency`, `docs` (branded PDF docs), `integrations/*` (pluggable adapters).
- `app/api/crud/[resource]` — generic CRUD engine with per-resource automations.
- `app/api/*` — dashboard, search, supplier broadcast, quote builder, quote→booking, payments, fx, ai, attendance, alerts scan, documents, reports, vonage webhook.
- `components/ResourcePage` — config-driven list+form engine; bespoke workspaces for leads, bookings, dashboard, calendar, finance, reports.

## Deploy

See `/SETUP-TASKS.html` tasks 1–2 (production Postgres + Render/Vercel). Set `DATABASE_URL` + a strong `JWT_SECRET`, run `db:push`, deploy.
