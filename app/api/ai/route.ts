import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, canAccessRecord } from "@/lib/auth";
import { aiRun, AiTask } from "@/lib/integrations/ai";

export const dynamic = "force-dynamic";

// POST { task, leadId?, context?, prompt? } — run an AI assist task.
// Output is always returned as editable text (never auto-applied).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { task, leadId, context, prompt } = await req.json();

  let ctx: Record<string, any> = context || {};
  if (leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: Number(leadId) },
      include: { brand: { select: { name: true } }, country: { select: { name: true } }, communications: { take: 10, orderBy: { occurredAt: "desc" } } },
    });
    // object-level authorisation (P0-02): agents may only run AI over their leads
    if (lead && !canAccessRecord(session, lead, "assignedToId")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (lead) {
      ctx = {
        customerName: lead.customerName,
        companyName: lead.companyName,
        email: lead.email,
        phone: lead.phone,
        status: lead.status,
        pickupLocation: lead.pickupLocation,
        dropoffLocation: lead.dropoffLocation,
        travelDate: lead.travelDate,
        passengerCount: lead.passengerCount,
        brand: lead.brand?.name,
        country: lead.country?.name,
        notes: lead.notes,
        recentComms: lead.communications.map((c) => `${c.channel}/${c.direction}: ${c.summary}`),
        ...ctx,
      };
    }
  }

  const result = await aiRun(task as AiTask, ctx, prompt);

  // persist scoring back to the lead when relevant
  if (leadId && task === "score_lead") {
    const m = result.text.match(/(\d{1,3})\s*\/\s*100/);
    if (m) await prisma.lead.update({ where: { id: Number(leadId) }, data: { aiQualityScore: Number(m[1]) } }).catch(() => {});
  }
  if (leadId && task === "predict_conversion") {
    const m = result.text.match(/(\d{1,3})\s*%/);
    if (m) await prisma.lead.update({ where: { id: Number(leadId) }, data: { aiConversionPct: Number(m[1]) } }).catch(() => {});
  }

  return NextResponse.json(result);
}
