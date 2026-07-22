import { NextResponse } from "next/server";
import { z, ZodError, ZodSchema } from "zod";

// Shared runtime-validation helper for command endpoints. Every guarded business
// command (acceptance, supplier acceptance, payments, finance corrections, …)
// parses its body through a Zod schema so malformed input is rejected with clear,
// field-level errors instead of reaching Prisma. Returns either the typed data or
// a ready-to-return 400 NextResponse describing exactly which fields failed.
export type ParseResult<T> = { ok: true; data: T } | { ok: false; res: NextResponse };

export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, res: NextResponse.json({ error: "Validation failed", fields: fieldErrors(parsed.error) }, { status: 400 }) };
  }
  return { ok: true, data: parsed.data };
}

export function fieldErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

// Reusable field schemas shared across commands.
export const isoCurrency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code");

// Money as a positive value. Kept as a string|number and validated as a finite,
// strictly-positive number so callers can hand it to Prisma.Decimal safely.
export const positiveAmount = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "string" ? Number(v) : v))
  .refine((n) => Number.isFinite(n) && n > 0, "Amount must be a positive number");

export const optionalNote = z.string().trim().max(2000).optional().nullable();

export { z };
