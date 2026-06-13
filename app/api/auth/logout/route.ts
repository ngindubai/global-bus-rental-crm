import { NextResponse } from "next/server";
import { COOKIE_NAME, getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getSession();
  if (session) {
    await prisma.user.update({ where: { id: session.id }, data: { online: false } }).catch(() => {});
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
