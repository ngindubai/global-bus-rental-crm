import { vonageConfigured } from "./vonage";
import { stripeConfigured } from "./stripe";
import { fxConfigured } from "./fx";
import { aiConfigured } from "./ai";

// Single source of truth for "is this integration live?" — drives the
// Settings → Integrations status board and the SETUP-TASKS checklist.
export function integrationStatus() {
  return [
    {
      key: "vonage",
      name: "Vonage Voice",
      module: "Calls (17)",
      configured: vonageConfigured(),
      desc: "Inbound call popups, caller-ID matching, missed-call alerts, call logs on leads.",
    },
    {
      key: "stripe",
      name: "Stripe Payments",
      module: "Finance (13)",
      configured: stripeConfigured(),
      desc: "Customer payment links for booking invoices.",
    },
    {
      key: "fx",
      name: "Live Exchange Rates",
      module: "Currency (14)",
      configured: fxConfigured(),
      desc: "Live FX rates for multi-currency quoting and profit reporting.",
    },
    {
      key: "ai",
      name: "AI Assistant (Claude)",
      module: "AI (22)",
      configured: aiConfigured(),
      desc: "Draft emails/WhatsApp, summaries, lead scoring, supplier suggestions.",
    },
  ];
}

export { vonageConfigured, stripeConfigured, fxConfigured, aiConfigured };
