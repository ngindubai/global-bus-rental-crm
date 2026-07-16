import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notify, raiseAlert } from "@/lib/auth";
import { verifyVonageWebhook, matchLeadByNumber, isMissed } from "@/lib/integrations/vonage";

export const dynamic = "force-dynamic";

// Vonage posts call events here (Module 17). Records a CallLog, matches the
// caller to a lead, fires a missed-call alert + notification. Works in stub mode
// (no credentials) so the call workflow is testable end-to-end.
export async function POST(req: NextRequest) {
  const ok = await verifyVonageWebhook(req.headers.get("authorization"));
  if (!ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  const e = await req.json().catch(() => ({}));
  const from = e.from || e.From || null;
  const to = e.to || e.To || null;
  const direction = e.direction || "inbound";
  const status = e.status || e.Status || "completed";
  const durationSecs = Number(e.duration || e.Duration || 0) || null;

  // Event idempotency (P0-09): a replayed webhook with the same provider UUID
  // must not create duplicate call logs, communications, or alerts.
  const uuid = e.uuid || e.conversation_uuid || null;
  if (uuid) {
    const seen = await prisma.callLog.findFirst({ where: { vonageUuid: uuid }, select: { id: true } });
    if (seen) return NextResponse.json({ ok: true, callId: seen.id, duplicate: true });
  }

  const lead = await matchLeadByNumber(direction === "outbound" ? to : from);
  const missed = isMissed(status);

  const call = await prisma.callLog.create({
    data: {
      direction: missed ? "missed" : direction,
      fromNumber: from,
      toNumber: to,
      durationSecs,
      recordingUrl: e.recording_url || e.recordingUrl || null,
      vonageUuid: uuid,
      status: status,
      leadId: lead?.id ?? null,
      userId: lead?.assignedToId ?? null,
      startedAt: e.timestamp ? new Date(e.timestamp) : new Date(),
    },
  });

  if (lead) {
    await prisma.communication.create({
      data: {
        channel: "Phone",
        direction: direction === "outbound" ? "Outbound" : "Inbound",
        party: "customer",
        summary: `${missed ? "Missed call" : "Call"} ${direction} ${durationSecs ? `(${durationSecs}s)` : ""}`,
        leadId: lead.id,
        userId: lead.assignedToId ?? undefined,
      },
    });
    if (missed) {
      await notify(lead.assignedToId, "Missed call", `${lead.customerName} (${from})`, `/leads/${lead.id}`);
      await raiseAlert({ type: "missed_call", severity: "warning", title: `Missed call: ${lead.customerName}`, body: `From ${from}`, entityType: "leads", entityId: lead.id });
    } else if (direction === "inbound") {
      // inbound answered call counts as first response
      await prisma.lead.update({ where: { id: lead.id }, data: { firstResponseAt: new Date(), lastContactAt: new Date() } }).catch(() => {});
    }
  } else if (missed) {
    await raiseAlert({ type: "missed_call", severity: "info", title: `Missed call from unknown number`, body: `From ${from}` });
  }

  return NextResponse.json({ ok: true, callId: call.id, matchedLead: lead?.id ?? null });
}
