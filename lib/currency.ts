import { prisma } from "./db";
import { fetchLiveRate } from "./integrations/fx";

const BASE = process.env.BASE_CURRENCY || "USD";

export function baseCurrency() {
  return BASE;
}

// Resolve an exchange rate from `from` -> `to`.
// Priority: identity > stored rate > live API (cached back to DB) > 1 (fallback).
export async function getRate(from?: string | null, to?: string | null): Promise<number> {
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
  return stored?.rate ?? 1;
}

export async function convert(amount: number, from?: string | null, to?: string | null): Promise<number> {
  const rate = await getRate(from, to);
  return Math.round(amount * rate * 100) / 100;
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
