import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createToken, COOKIE_NAME, getIp } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  const ip = getIp(req);
  const userAgent = req.headers.get("user-agent") || "";

  const user = await prisma.user.findUnique({ where: { email: (email || "").toLowerCase().trim() } });
  const ok = user && user.active && (await bcrypt.compare(password || "", user.passwordHash));

  await prisma.loginLog.create({
    data: { userId: user?.id, email, success: !!ok, ip, userAgent },
  });

  if (!ok) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

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
