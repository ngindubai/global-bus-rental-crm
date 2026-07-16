import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createToken, COOKIE_NAME, getIp } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Simple in-memory login throttle (P1-18). Keyed by IP+email; after a burst of
// failures the key is locked out for a cooling-off window. In-memory is adequate
// for the single always-on instance; a distributed deploy should move this to a
// shared store. Successful logins clear the counter.
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000; // rolling window / lockout duration
const attempts = new Map<string, { fails: number; first: number; lockedUntil: number }>();

function throttleKey(ip: string, email: string) {
  return `${ip}|${(email || "").toLowerCase().trim()}`;
}

function checkLock(key: string): number {
  const rec = attempts.get(key);
  if (!rec) return 0;
  const now = Date.now();
  if (rec.lockedUntil && rec.lockedUntil > now) return Math.ceil((rec.lockedUntil - now) / 1000);
  if (now - rec.first > WINDOW_MS) attempts.delete(key);
  return 0;
}

function registerFail(key: string) {
  const now = Date.now();
  const rec = attempts.get(key) || { fails: 0, first: now, lockedUntil: 0 };
  if (now - rec.first > WINDOW_MS) { rec.fails = 0; rec.first = now; rec.lockedUntil = 0; }
  rec.fails += 1;
  if (rec.fails >= MAX_FAILS) rec.lockedUntil = now + WINDOW_MS;
  attempts.set(key, rec);
}

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  const ip = getIp(req);
  const userAgent = req.headers.get("user-agent") || "";

  const key = throttleKey(ip, email);
  const lockedFor = checkLock(key);
  if (lockedFor > 0) {
    await prisma.loginLog.create({ data: { userId: null, email, success: false, ip, userAgent } }).catch(() => {});
    return NextResponse.json(
      { error: `Too many failed attempts. Try again in ${Math.ceil(lockedFor / 60)} minute(s).` },
      { status: 429, headers: { "retry-after": String(lockedFor) } }
    );
  }

  const user = await prisma.user.findUnique({ where: { email: (email || "").toLowerCase().trim() } });
  const ok = user && user.active && (await bcrypt.compare(password || "", user.passwordHash));

  await prisma.loginLog.create({
    data: { userId: user?.id, email, success: !!ok, ip, userAgent },
  });

  if (!ok) {
    registerFail(key);
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  attempts.delete(key);

  await prisma.user.update({ where: { id: user!.id }, data: { online: true, lastSeenAt: new Date() } });

  const token = await createToken({ id: user!.id, name: user!.name, email: user!.email, role: user!.role });
  const res = NextResponse.json({
    user: { id: user!.id, name: user!.name, email: user!.email, role: user!.role },
  });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return res;
}
