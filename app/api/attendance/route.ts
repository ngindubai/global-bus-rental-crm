import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, getIp } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET — current open attendance row for the user + today's history
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const open = await prisma.attendance.findFirst({
    where: { userId: session.id, clockOutAt: null },
    orderBy: { createdAt: "desc" },
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = await prisma.attendance.findMany({
    where: { userId: session.id, createdAt: { gte: today } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ open, rows });
}

// POST { action: 'in'|'out'|'break', breakMins? }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { action, breakMins } = await req.json();
  const ip = getIp(req);
  const userAgent = req.headers.get("user-agent") || "";

  const open = await prisma.attendance.findFirst({ where: { userId: session.id, clockOutAt: null }, orderBy: { createdAt: "desc" } });

  if (action === "in") {
    if (open) return NextResponse.json({ error: "Already clocked in" }, { status: 400 });
    const row = await prisma.attendance.create({ data: { userId: session.id, clockInAt: new Date(), ip, userAgent } });
    await prisma.user.update({ where: { id: session.id }, data: { online: true } });
    return NextResponse.json({ row });
  }
  if (action === "out") {
    if (!open) return NextResponse.json({ error: "Not clocked in" }, { status: 400 });
    const row = await prisma.attendance.update({ where: { id: open.id }, data: { clockOutAt: new Date() } });
    return NextResponse.json({ row });
  }
  if (action === "break") {
    if (!open) return NextResponse.json({ error: "Not clocked in" }, { status: 400 });
    const row = await prisma.attendance.update({ where: { id: open.id }, data: { breakMins: { increment: Number(breakMins || 15) } } });
    return NextResponse.json({ row });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
