// ─────────────────────────────────────────────────────────────────────────────
// Render pre-deploy: baseline-aware, idempotent, safe. Runs BEFORE the new
// instance serves traffic; a non-zero exit aborts the release with the old
// instance still live (no partial state).
//
// Why this exists: production was previously managed by `prisma db push`, so it
// has all the tables but NO `_prisma_migrations` history. Plain `migrate deploy`
// then fails with P3005 ("the database schema is not empty"). This script detects
// that exact situation and marks ONLY the baseline migration (which represents the
// already-present schema) as applied — it never marks the upgrade as applied — then
// runs `migrate deploy` so only the real upgrade is applied.
//
// Idempotent:
//   • existing db-push DB (no _prisma_migrations, tables present) → baseline, then deploy
//   • fresh DB (no tables)                                        → deploy applies baseline+upgrade
//   • already migrated (history present)                          → deploy is a no-op
// then the idempotent backfill and the production-safe seed.
// ─────────────────────────────────────────────────────────────────────────────
const { execSync } = require("child_process");
const { PrismaClient } = require("@prisma/client");

const BASELINE = "20260101000000_baseline_production";
const run = (cmd) => execSync(cmd, { stdio: "inherit" });

async function regclass(prisma, ident) {
  // Cast to text — Prisma cannot deserialize the raw `regclass` type.
  const rows = await prisma.$queryRawUnsafe(`SELECT to_regclass('${ident}')::text AS t`);
  return rows && rows[0] && rows[0].t != null;
}

async function needsBaseline() {
  const prisma = new PrismaClient();
  try {
    // If Prisma migration history already exists, nothing to baseline.
    if (await regclass(prisma, "public._prisma_migrations")) return false;
    // No history. Baseline ONLY if the schema is already present (an existing
    // db-push-managed database) — otherwise it's a fresh DB and migrate deploy
    // should create everything from the baseline migration itself.
    return await regclass(prisma, 'public."User"');
  } finally {
    await prisma.$disconnect();
  }
}

(async () => {
  if (await needsBaseline()) {
    console.log(`→ Existing db-push-managed database detected with no migration history.`);
    console.log(`→ Baselining: marking ${BASELINE} as already applied (schema already present).`);
    run(`npx prisma migrate resolve --applied ${BASELINE}`);
  }
  console.log("→ prisma migrate deploy");
  run("npx prisma migrate deploy");
  console.log("→ data backfill (idempotent)");
  run("node scripts/backfill.js");
  console.log("→ production-safe seed");
  run("npm run db:seed");
  console.log("✅ Pre-deploy complete.");
})().catch((e) => {
  console.error("Pre-deploy failed:", e && e.message ? e.message : e);
  process.exit(1);
});
