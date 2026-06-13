// Local PostgreSQL for development — no Docker, no system install.
// Runs a real Postgres server as a plain Node process via embedded-postgres.
// Usage: `npm run db:up` (leave running), then db:push / db:seed / dev in another terminal.
const path = require("path");
const fs = require("fs");
const EmbeddedPostgres = require("embedded-postgres").default || require("embedded-postgres");

const DATA_DIR = path.join(__dirname, "..", ".pgdata");
const PORT = 5433;

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "gbr",
  password: "gbr_dev_pw",
  port: PORT,
  persistent: true,
  // UTF8 cluster (matches production Postgres) so non-Latin text stores cleanly
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  // default every session's client_encoding to UTF8 (Windows otherwise picks WIN1252)
  postgresFlags: ["-c", "client_encoding=UTF8"],
});

async function main() {
  const initialised = fs.existsSync(path.join(DATA_DIR, "PG_VERSION"));
  if (!initialised) {
    console.log("Initialising Postgres data directory…");
    await pg.initialise();
  }
  // clear a stale lock from an unclean shutdown
  const pid = path.join(DATA_DIR, "postmaster.pid");
  if (fs.existsSync(pid)) {
    try { fs.unlinkSync(pid); } catch {}
  }

  await pg.start();

  // Create gbr_crm explicitly as UTF8. On Windows the cluster + templates init
  // as WIN1252, and a plain createDatabase() clones that — which then rejects
  // non-Latin text (Arabic names etc.). Building from template0 with a C locale
  // lets us force UTF8. Also pin client_encoding so Prisma sessions don't inherit
  // the Windows codepage.
  const { Client } = require("pg");
  const admin = new Client({ host: "localhost", port: PORT, user: "gbr", password: "gbr_dev_pw", database: "postgres" });
  try {
    await admin.connect();
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname='gbr_crm'");
    if (exists.rowCount === 0) {
      await admin.query("CREATE DATABASE gbr_crm WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0");
      console.log("Created database 'gbr_crm' (UTF8).");
    }
    await admin.query("ALTER DATABASE gbr_crm SET client_encoding TO 'UTF8'");
    await admin.query("ALTER ROLE gbr SET client_encoding TO 'UTF8'");
    await admin.end();
  } catch (e) {
    console.warn("Database setup warning:", e.message);
    try { await admin.end(); } catch {}
  }

  console.log(`\n✅ Postgres ready on localhost:${PORT}  (database: gbr_crm)`);
  console.log("   Leave this terminal running. Press Ctrl+C to stop.\n");

  const stop = async () => {
    console.log("\nStopping Postgres…");
    try { await pg.stop(); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error("Failed to start embedded Postgres:", e);
  process.exit(1);
});
