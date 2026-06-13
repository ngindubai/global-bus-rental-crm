import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const items = await prisma.notification.findMany({
    where: { userId: session.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const unread = await prisma.notification.count({ where: { userId: session.id, readAt: null } });
  return NextResponse.json({ items, unread });
}

export async function PATCH() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  await prisma.notification.updateMany({ where: { userId: session.id, readAt: null }, data: { readAt: new Date() } });
  return NextResponse.json({ ok: true });
}
