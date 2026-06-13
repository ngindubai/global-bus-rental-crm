import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSession, logActivity, getIp } from "@/lib/auth";

export const dynamic = "force-dynamic";

function canManage(role: string) {
  return role === "ADMIN" || role === "MANAGER";
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, email: true, role: true, phone: true, active: true,
      online: true, lastSeenAt: true, countryId: true,
      country: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({ items: users, total: users.length });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !canManage(session.role)) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const body = await req.json();
  const { name, email, password, role, phone, countryId, active } = body;
  if (!name || !email || !password) return NextResponse.json({ error: "Name, email and password are required" }, { status: 400 });

  try {
    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase().trim(),
        passwordHash: await bcrypt.hash(password, 10),
        role: role || "AGENT",
        phone: phone || null,
        countryId: countryId ? Number(countryId) : null,
        active: active === undefined ? true : !!active,
      },
    });
    await logActivity({ userId: session.id, action: "create", entityType: "users", entityId: user.id, ip: getIp(req) });
    return NextResponse.json({ item: { id: user.id } }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.code === "P2002" ? "Email already exists" : e.message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !canManage(session.role)) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const body = await req.json();
  const id = Number(body.id);
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const data: any = {};
  for (const k of ["name", "email", "role", "phone"]) if (body[k] !== undefined) data[k] = body[k];
  if (body.email) data.email = body.email.toLowerCase().trim();
  if (body.countryId !== undefined) data.countryId = body.countryId ? Number(body.countryId) : null;
  if (body.active !== undefined) data.active = !!body.active;
  if (body.password) data.passwordHash = await bcrypt.hash(body.password, 10);

  try {
    await prisma.user.update({ where: { id }, data });
    await logActivity({ userId: session.id, action: "update", entityType: "users", entityId: id, ip: getIp(req) });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
