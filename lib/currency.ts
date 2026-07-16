import { prisma } from "./db";
import { fetchLiveRate } from "./integrations/fx";

const BASE = process.env.BASE_CURRENCY || "USD";

export function baseCurrency() {
  return BASE;
}

// Thrown when a cross-currency conversion is requested but no trustworthy rate
// exists. Callers that must not misprice (quoting) surface this to the user
// instead of silently assuming a 1:1 rate.
export class MissingRateError extends Error {
  constructor(public from: string, public to: string) {
    super(`No exchange rate available for ${from} → ${to}`);
    this.name = "MissingRateError";
  }
}

// Resolve an exchange rate from `from` -> `to`.
// Priority: identity > stored rate > live API (cached back to DB).
// When no rate can be resolved: strict callers get a MissingRateError; lenient
// callers get null so they can decide how to represent the gap (they must NOT
// silently substitute 1 across different currencies).
export async function getRate(
  from?: string | null,
  to?: string | null,
  opts: { strict?: boolean } = {}
): Promise<number> {
  const f = (from || BASE).toUpperCase();
  const t = (to || BASE).toUpperCase();
  if (f === t) return 1;

  const stored = await prisma.exchangeRate.findUnique({ where: { base_quote: { base: f, quote: t } } });
  // Use a stored rate if it is fresh-ish (<12h) or manual.
  if (stored) {
    const ageMs = Date.now() - new Date(stored.fetchedAt).getTime();
    if (stored.source === "manual" || ageMs < 12 * 60 * 60 * 1000) return stored.rate;
  }

  const live = await fetchLiveRate(f, t);
  if (live != null) {
    await prisma.exchangeRate.upsert({
      where: { base_quote: { base: f, quote: t } },
      create: { base: f, quote: t, rate: live, source: "api" },
      update: { rate: live, source: "api", fetchedAt: new Date() },
    });
    return live;
  }
  // A stale stored rate is still better than nothing for lenient callers.
  if (stored) return stored.rate;
  if (opts.strict) throw new MissingRateError(f, t);
  return NaN; // signals "unknown" — lenient callers handle it explicitly
}

// Strict resolution used by pricing paths; never falls back to 1.
export async function getRateStrict(from?: string | null, to?: string | null): Promise<number> {
  return getRate(from, to, { strict: true });
}

export async function convert(amount: number, from?: string | null, to?: string | null): Promise<number> {
  const rate = await getRate(from, to);
  if (!isFinite(rate)) return NaN;
  return Math.round(amount * rate * 100) / 100;
}

// A short-lived, memoised rate resolver for aggregation paths (reports,
// dashboard) so converting many rows to the reporting currency does not issue a
// query per row. Rows whose rate is unknown are reported via `unconverted` so
// totals never silently absorb a bad 1:1 assumption.
export function makeRateCache(reportingCurrency = BASE) {
  const cache = new Map<string, Promise<number>>();
  let unconverted = 0;
  function rate(from?: string | null) {
    const f = (from || reportingCurrency).toUpperCase();
    const key = `${f}->${reportingCurrency}`;
    if (!cache.has(key)) cache.set(key, getRate(f, reportingCurrency));
    return cache.get(key)!;
  }
  return {
    reportingCurrency,
    async toBase(amount?: number | null, from?: string | null): Promise<number> {
      if (!amount) return 0;
      const r = await rate(from);
      if (!isFinite(r)) {
        unconverted += 1;
        return 0; // exclude un-rateable amounts rather than corrupt the total
      }
      return Math.round(amount * r * 100) / 100;
    },
    unconverted: () => unconverted,
  };
}

export function profitAndMargin(supplierCost: number, customerPrice: number) {
  const profit = Math.round((customerPrice - supplierCost) * 100) / 100;
  const margin = customerPrice > 0 ? Math.round((profit / customerPrice) * 10000) / 100 : 0;
  return { profit, margin };
}

export function fmtMoney(amount?: number | null, currency = BASE) {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
