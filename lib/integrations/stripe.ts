// Stripe adapter for customer payment links (Module 13).
// Real calls plug in via STRIPE_SECRET_KEY. Without a key, returns a clearly
// labelled placeholder link so the booking/payment workflow stays usable.

export function stripeConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

export type PaymentLinkResult = {
  url: string;
  id: string;
  stub: boolean;
};

// Creates a Stripe Payment Link for a given amount/currency.
export async function createPaymentLink(opts: {
  amount: number; // major units, e.g. 250.00
  currency: string; // ISO, e.g. "usd"
  description: string;
  reference?: string;
}): Promise<PaymentLinkResult> {
  if (!stripeConfigured()) {
    const id = `stub_${opts.reference || Date.now()}`;
    return { url: `#stripe-not-configured-${encodeURIComponent(opts.description).slice(0, 40)}`, id, stub: true };
  }
  try {
    // Stripe Payment Links require a Price; for an ad-hoc amount we create a
    // one-off Price against an inline product, then a Payment Link.
    const cents = Math.round(opts.amount * 100);
    const cur = opts.currency.toLowerCase();

    const price = await stripePost("/v1/prices", {
      currency: cur,
      unit_amount: String(cents),
      "product_data[name]": opts.description.slice(0, 250),
    });
    const link = await stripePost("/v1/payment_links", {
      "line_items[0][price]": price.id,
      "line_items[0][quantity]": "1",
      ...(opts.reference ? { "metadata[reference]": opts.reference } : {}),
    });
    return { url: link.url, id: link.id, stub: false };
  } catch (e) {
    console.error("stripe link failed", e);
    const id = `error_${Date.now()}`;
    return { url: `#stripe-error`, id, stub: true };
  }
}

async function stripePost(path: string, form: Record<string, string>) {
  const body = new URLSearchParams(form).toString();
  const r = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
