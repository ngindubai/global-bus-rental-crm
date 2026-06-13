import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const where: any = {};
  if (sp.get("entityType")) where.entityType = sp.get("entityType");
  if (sp.get("action")) where.action = sp.get("action");

  const items = await prisma.activityLog.findMany({
    where,
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return NextResponse.json({ items });
}
