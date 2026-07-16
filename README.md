# Global Bus Rental — CRM (Phase 1)

Responsive web CRM & operations platform for passenger-transport enquiries: lead → supplier quoting → branded quotes → bookings → payments → profit reporting, with staff monitoring, an executive dashboard, and AI assistance.

**Stack:** Next.js 14 (App Router) · Prisma · PostgreSQL · Tailwind · JWT auth.

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
