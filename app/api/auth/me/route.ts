import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  // touch presence
  await prisma.user.update({ where: { id: session.id }, data: { lastSeenAt: new Date(), online: true } }).catch(() => {});
  return NextResponse.json({ user: session });
}
