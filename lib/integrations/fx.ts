// Exchange-rate adapter. Real provider plugs in via FX_API_KEY.
// Without a key, returns null so currency.ts falls back to stored/manual rates.

export function fxConfigured() {
  return !!process.env.FX_API_KEY;
}

export async function fetchLiveRate(from: string, to: string): Promise<number | null> {
  if (!fxConfigured()) return null;
  const provider = process.env.FX_PROVIDER || "exchangerate-api";
  try {
    if (provider === "exchangerate-api") {
      // https://www.exchangerate-api.com/  — /v6/KEY/pair/FROM/TO
      const url = `https://v6.exchangerate-api.com/v6/${process.env.FX_API_KEY}/pair/${from}/${to}`;
      const r = await fetch(url, { next: { revalidate: 3600 } });
      if (!r.ok) return null;
      const j = await r.json();
      return typeof j.conversion_rate === "number" ? j.conversion_rate : null;
    }
    if (provider === "openexchangerates") {
      const url = `https://openexchangerates.org/api/latest.json?app_id=${process.env.FX_API_KEY}&base=${from}&symbols=${to}`;
      const r = await fetch(url, { next: { revalidate: 3600 } });
      if (!r.ok) return null;
      const j = await r.json();
      return j.rates?.[to] ?? null;
    }
  } catch (e) {
    console.error("fx fetch failed", e);
  }
  return null;
}
