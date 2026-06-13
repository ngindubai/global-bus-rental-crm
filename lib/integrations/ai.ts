// AI assistant adapter (Anthropic Claude). Real calls plug in via ANTHROPIC_API_KEY.
// Without a key, returns clearly-labelled deterministic drafts so the workflow is
// fully usable and every output remains editable before use (Module 22).

export function aiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const MODEL = process.env.AI_MODEL || "claude-opus-4-8";

export type AiTask =
  | "draft_quote_email"
  | "draft_whatsapp_reply"
  | "summarise_call"
  | "summarise_whatsapp"
  | "summarise_lead"
  | "recommend_followup"
  | "score_lead"
  | "predict_conversion"
  | "suggest_supplier"
  | "lost_deal_analysis"
  | "management_report";

export type AiResult = { text: string; stub: boolean; model: string; meta?: any };

const SYSTEM = `You are an assistant inside the Global Bus Rental CRM. You help passenger-transport
sales agents draft customer-facing messages, summarise conversations, and recommend next actions.
Be concise, professional, and never invent prices the agent did not provide.`;

// Single entry point. Callers pass a task + a context blob.
export async function aiRun(task: AiTask, context: Record<string, any>, prompt?: string): Promise<AiResult> {
  if (!aiConfigured()) {
    return { text: stubFor(task, context), stub: true, model: "stub" };
  }
  try {
    const userContent = `${prompt ? prompt + "\n\n" : ""}Task: ${task}\nContext (JSON):\n${JSON.stringify(
      context
    ).slice(0, 6000)}`;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return { text: stubFor(task, context), stub: true, model: "stub", meta: { error: errText.slice(0, 300) } };
    }
    const j = await r.json();
    const text = (j.content?.[0]?.text as string) || stubFor(task, context);
    return { text, stub: false, model: MODEL };
  } catch (e: any) {
    return { text: stubFor(task, context), stub: true, model: "stub", meta: { error: String(e).slice(0, 300) } };
  }
}

// ── deterministic, useful stubs ──────────────────────────────────────────────
function stubFor(task: AiTask, ctx: Record<string, any>): string {
  const name = ctx.customerName || ctx.name || "there";
  const brand = ctx.brand || "Global Bus Rental";
  switch (task) {
    case "draft_quote_email":
      return [
        `Subject: Your transport quote from ${brand}`,
        ``,
        `Dear ${name},`,
        ``,
        `Thank you for your enquiry. Please find our proposed quote below for your trip` +
          (ctx.pickupLocation ? ` from ${ctx.pickupLocation}` : "") +
          (ctx.dropoffLocation ? ` to ${ctx.dropoffLocation}` : "") +
          (ctx.travelDate ? ` on ${new Date(ctx.travelDate).toLocaleDateString("en-GB")}` : "") +
          `.`,
        ``,
        ctx.customerPrice ? `Total price: ${ctx.customerCurrency || ""} ${ctx.customerPrice}` : `Total price: [add amount]`,
        ``,
        `This quote is valid for 7 days. Reply to confirm and we will secure your vehicle.`,
        ``,
        `Kind regards,`,
        `${brand}`,
      ].join("\n");
    case "draft_whatsapp_reply":
      return `Hi ${name}! Thanks for reaching out to ${brand}. We can help with your transport request. Could you confirm your travel date, pickup, drop-off and passenger count so we can prepare a quote? 🚌`;
    case "summarise_call":
      return `Call summary (draft): Customer ${name} discussed a transport requirement${
        ctx.passengerCount ? ` for ${ctx.passengerCount} passengers` : ""
      }. Action: prepare quote and follow up. [Edit before saving.]`;
    case "summarise_whatsapp":
      return `WhatsApp summary (draft): Conversation with ${name} regarding a booking enquiry. Key points and next steps to confirm. [Edit before saving.]`;
    case "summarise_lead":
      return `Lead summary (draft): ${name}${ctx.companyName ? ` (${ctx.companyName})` : ""} — ${
        ctx.status || "New"
      }. ${ctx.passengerCount || "?"} pax${ctx.pickupLocation ? `, ${ctx.pickupLocation}→${ctx.dropoffLocation || "?"}` : ""}. Recommended next step: contact and gather missing trip details. [Edit before use.]`;
    case "recommend_followup":
      return `Recommended follow-ups (draft):\n1. Confirm travel date & passenger count.\n2. Request supplier prices for the route.\n3. Send branded quote within SLA.\n[Edit before use.]`;
    case "score_lead": {
      const score = scoreHeuristic(ctx);
      return `Estimated lead quality: ${score}/100 (heuristic). Drivers: ${
        ctx.passengerCount ? "group size, " : ""
      }${ctx.travelDate ? "dated trip, " : ""}${ctx.companyName ? "corporate" : "private"}. [AI scoring inactive — connect Anthropic key.]`;
    }
    case "predict_conversion": {
      const score = scoreHeuristic(ctx);
      return `Estimated conversion likelihood: ${Math.round(score * 0.7)}% (heuristic). [Connect Anthropic key for model-based prediction.]`;
    }
    case "suggest_supplier":
      return `Supplier suggestion (draft): pick the fastest-responding active supplier in ${
        ctx.country || "the lead's country"
      } with matching vehicle capacity. See the Suppliers tab ranked by score. [Edit before use.]`;
    case "lost_deal_analysis":
      return `Lost-deal analysis (draft): review price competitiveness, response speed vs SLA, and supplier availability. [Connect Anthropic key for richer analysis.]`;
    case "management_report":
      return `Management report (draft): summarise leads, conversion, revenue, profit and SLA breaches for the selected period. [Connect Anthropic key to auto-generate.]`;
    default:
      return `[AI draft placeholder — connect Anthropic key in SETUP-TASKS.html]`;
  }
}

function scoreHeuristic(ctx: Record<string, any>): number {
  let s = 40;
  if (ctx.passengerCount) s += Math.min(20, Number(ctx.passengerCount));
  if (ctx.travelDate) s += 10;
  if (ctx.companyName) s += 15;
  if (ctx.email && ctx.phone) s += 10;
  return Math.max(1, Math.min(100, s));
}
