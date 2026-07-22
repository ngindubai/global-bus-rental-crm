import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { prisma } from "./db";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret");
export const COOKIE_NAME = "gbr_crm_session";

export type SessionUser = { id: number; name: string; email: string; role: string };

export async function createToken(user: SessionUser) {
  return await new SignJWT({ id: user.id, name: user.name, email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return {
      id: payload.id as number,
      name: payload.name as string,
      email: payload.email as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const claims = await verifyToken(token);
  if (!claims) return null;
  // Re-validate against the live user record (P1-17): a deactivated user loses
  // access immediately, and the current role — not the possibly-stale role baked
  // into the token — is what authorises the request.
  try {
    const user = await prisma.user.findUnique({
      where: { id: claims.id },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
    if (!user || !user.active) return null;
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  } catch {
    // If the lookup fails, fall back to the verified token rather than hard-failing.
    return claims;
  }
}

export function getIp(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

export async function requireAuth(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new AuthError("Not authenticated");
  return session;
}

export class AuthError extends Error {}

// Roles: ADMIN, MANAGER, AGENT, FINANCE
// ADMIN + MANAGER can write everything. AGENT runs the sales workflow.
// FINANCE owns payments/commissions.
export function canWrite(role: string, resource: string): boolean {
  if (role === "ADMIN" || role === "MANAGER") return true;
  const map: Record<string, string[]> = {
    leads: ["AGENT"],
    customers: ["AGENT", "FINANCE"],
    serviceLines: ["AGENT"],
    supplierRequests: ["AGENT"],
    quotes: ["AGENT"],
    bookings: ["AGENT", "FINANCE"],
    payments: ["FINANCE", "AGENT"],
    commissions: ["FINANCE"],
    suppliers: ["AGENT"],
    supplierVehicles: ["AGENT"],
    communications: ["AGENT", "FINANCE"],
    notes: ["AGENT", "FINANCE"],
    tasks: ["AGENT", "FINANCE"],
    callLogs: ["AGENT"],
    brands: [],
    countries: [],
    users: [],
  };
  return (map[resource] || []).includes(role);
}

// Object-level authorisation (P0-02). List queries scope AGENT rows by owner,
// but detail/update/delete fetch by id and must re-check ownership on the loaded
// record. Managers, finance and admins are not owner-scoped. `ownerField` is the
// resource's ownership column (e.g. assignedToId, agentId); when a resource has
// none, everyone authenticated may access it.
export function canAccessRecord(
  session: SessionUser,
  record: Record<string, any> | null | undefined,
  ownerField?: string
): boolean {
  if (!record) return false;
  if (session.role !== "AGENT") return true;
  if (!ownerField) return true;
  return record[ownerField] === session.id;
}

export async function logActivity(opts: {
  userId?: number | null;
  action: string;
  entityType?: string;
  entityId?: number;
  field?: string;
  oldValue?: any;
  newValue?: any;
  ip?: string;
}) {
  try {
    await prisma.activityLog.create({
      data: {
        userId: opts.userId ?? null,
        action: opts.action,
        entityType: opts.entityType,
        entityId: opts.entityId,
        field: opts.field,
        oldValue:
          opts.oldValue === undefined || opts.oldValue === null ? null : String(opts.oldValue).slice(0, 500),
        newValue:
          opts.newValue === undefined || opts.newValue === null ? null : String(opts.newValue).slice(0, 500),
        ip: opts.ip,
      },
    });
  } catch (e) {
    console.error("audit log failed", e);
  }
}

export async function notify(userId: number | null | undefined, title: string, body?: string, link?: string) {
  if (!userId) return;
  try {
    await prisma.notification.create({ data: { userId, title, body, link } });
  } catch (e) {
    console.error("notify failed", e);
  }
}

export async function raiseAlert(opts: {
  type: string;
  severity?: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: number;
}) {
  try {
    await prisma.alert.create({
      data: {
        type: opts.type,
        severity: opts.severity || "warning",
        title: opts.title,
        body: opts.body,
        entityType: opts.entityType,
        entityId: opts.entityId,
      },
    });
  } catch (e) {
    console.error("alert failed", e);
  }
}
