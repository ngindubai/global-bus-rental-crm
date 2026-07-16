// Vonage voice adapter (Module 17): inbound call popups, caller-ID matching,
// missed-call alerts, call duration + recording references attached to leads.
//
// Phase-1 design: Vonage posts call events to /api/integrations/vonage/events.
// This module verifies/parses those webhooks and matches caller numbers to leads.
// Without credentials, webhook handling still records CallLogs (so the UI works
// end-to-end), it simply skips signature verification and outbound API calls.

import { jwtVerify } from "jose";
import { prisma } from "../db";

export function vonageConfigured() {
  return !!(process.env.VONAGE_API_KEY && process.env.VONAGE_API_SECRET);
}

// Normalise a phone number to its trailing significant digits for matching.
export function normalizeNumber(n?: string | null) {
  if (!n) return "";
  return n.replace(/[^\d]/g, "").slice(-9);
}

// Find the most recent lead whose phone/whatsapp matches an inbound caller.
export async function matchLeadByNumber(caller?: string | null) {
  const tail = normalizeNumber(caller);
  if (!tail) return null;
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, OR: [{ phone: { contains: tail } }, { whatsapp: { contains: tail } }] },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, customerName: true, assignedToId: true },
  });
  return leads[0] || null;
}

// Verify a Vonage webhook (P0-09). Vonage signs webhooks with a JWT in the
// `Authorization: Bearer <jwt>` header, HS256-signed with the signature secret.
// When a signature secret is configured we REQUIRE and verify that JWT and reject
// anything unsigned or tampered. When no secret is configured we only accept
// unsigned webhooks outside production so local/dev stub testing still flows —
// production never accepts an unsigned Vonage webhook.
export async function verifyVonageWebhook(authHeader?: string | null): Promise<boolean> {
  const secret = process.env.VONAGE_SIGNATURE_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

export type CallEvent = {
  direction?: string; // inbound | outbound
  from?: string;
  to?: string;
  status?: string; // answered | completed | unanswered | missed | timeout
  durationSecs?: number;
  recordingUrl?: string;
  uuid?: string;
  startedAt?: Date;
};

export function isMissed(status?: string) {
  if (!status) return false;
  return ["unanswered", "missed", "timeout", "rejected", "busy", "failed"].includes(status.toLowerCase());
}
