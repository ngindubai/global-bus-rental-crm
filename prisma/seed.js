const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const prisma = new PrismaClient();

// Sample/demo data (fake users, leads, bookings) must NEVER be created on a
// production database. It is only seeded when explicitly requested via
// SEED_SAMPLE_DATA=true (used for local dev / staging). In production the seed
// provisions reference data and a single real administrator whose credentials
// come from the environment — it never resets an existing user's password.
const SEED_SAMPLE_DATA =
  process.env.SEED_SAMPLE_DATA === "true" || process.env.NODE_ENV !== "production";

async function main() {
  const pw = (p) => bcrypt.hashSync(p, 10);

  await seedAdmin(pw);

  if (!SEED_SAMPLE_DATA) {
    console.log("✅ Seed complete (production mode: reference admin only, no sample data).");
    return;
  }

  // ── Countries ──
  const uae = await up("country", { name: "United Arab Emirates" }, { isoCode: "AE", currency: "AED", currencySymbol: "د.إ", timezone: "Asia/Dubai", languages: "Arabic, English" });
  const uk = await up("country", { name: "United Kingdom" }, { isoCode: "GB", currency: "GBP", currencySymbol: "£", timezone: "Europe/London", languages: "English" });
  const ksa = await up("country", { name: "Saudi Arabia" }, { isoCode: "SA", currency: "SAR", currencySymbol: "﷼", timezone: "Asia/Riyadh", languages: "Arabic, English" });

  // ── Brands ──
  const brand = await up("brand", { name: "Global Bus Rental" }, {
    displayName: "Global Bus Rental", websiteUrl: "https://globalbusrental.com",
    primaryColor: "#0f5b68", accentColor: "#f5a623",
    contactEmail: "bookings@globalbusrental.com", contactPhone: "+971 4 000 0000",
    quoteFooter: "Global Bus Rental — quote valid for 7 days. Prices include driver & fuel unless stated.",
    invoiceFooter: "Thank you for choosing Global Bus Rental. Payment due before travel date.",
  });
  await up("brand", { name: "DubaiCoachHire" }, { displayName: "Dubai Coach Hire", primaryColor: "#1d4ed8", accentColor: "#f59e0b", contactEmail: "hello@dubaicoachhire.com" });

  // ── Users ──
  const admin = await up("user", { email: "admin@globalbusrental.com" }, { name: "System Admin", passwordHash: pw("admin123"), role: "ADMIN", phone: "+971500000001" });
  const manager = await up("user", { email: "manager@globalbusrental.com" }, { name: "Mariam Hassan", passwordHash: pw("manager123"), role: "MANAGER", phone: "+971500000002" });
  const agent1 = await up("user", { email: "ahmed@globalbusrental.com" }, { name: "Ahmed Khan", passwordHash: pw("agent123"), role: "AGENT", countryId: uae.id, phone: "+971500000003" });
  const agent2 = await up("user", { email: "sophie@globalbusrental.com" }, { name: "Sophie Bennett", passwordHash: pw("agent123"), role: "AGENT", countryId: uk.id, phone: "+447700000004" });
  const finance = await up("user", { email: "finance@globalbusrental.com" }, { name: "Raj Patel", passwordHash: pw("finance123"), role: "FINANCE", phone: "+971500000005" });
  await prisma.country.update({ where: { id: uae.id }, data: { managerId: agent1.id } });
  await prisma.country.update({ where: { id: uk.id }, data: { managerId: agent2.id } });

  // ── Suppliers ──
  const supA = await up("supplier", { companyName: "Emirates Coaches LLC" }, { contactPerson: "Yusuf", phone: "+971501112222", email: "ops@emiratescoaches.ae", countryId: uae.id, serviceAreas: "Dubai, Abu Dhabi, Sharjah", currency: "AED", paymentTerms: "50% deposit", rating: 4.5, score: 82, avgResponseMins: 25, acceptanceRate: 0.8, active: true });
  const supB = await up("supplier", { companyName: "Gulf Luxury Transport" }, { contactPerson: "Fatima", phone: "+971503334444", email: "book@gulfluxury.ae", countryId: uae.id, serviceAreas: "Dubai, Al Ain", currency: "AED", paymentTerms: "Full before travel", rating: 4.0, score: 74, avgResponseMins: 40, acceptanceRate: 0.65, active: true });
  const supC = await up("supplier", { companyName: "London Minibus Co" }, { contactPerson: "George", phone: "+447701234567", email: "hire@londonminibus.co.uk", countryId: uk.id, serviceAreas: "Greater London, Heathrow, Gatwick", currency: "GBP", paymentTerms: "Net 7", rating: 4.2, score: 78, avgResponseMins: 30, acceptanceRate: 0.7, active: true });
  await prisma.supplierVehicle.createMany({ data: [
    { supplierId: supA.id, vehicleType: "50-seat coach", seats: 50, luggageCapacity: "Large hold", quantity: 6 },
    { supplierId: supA.id, vehicleType: "22-seat minibus", seats: 22, luggageCapacity: "Medium", quantity: 4 },
    { supplierId: supB.id, vehicleType: "14-seat luxury van", seats: 14, luggageCapacity: "Medium", quantity: 5 },
    { supplierId: supC.id, vehicleType: "16-seat minibus", seats: 16, luggageCapacity: "Medium", quantity: 8 },
  ]});

  // ── FX rates ──
  await up("exchangeRate", { base_quote: { base: "USD", quote: "AED" } }, { base: "USD", quote: "AED", rate: 3.67, source: "manual" }, true);
  await up("exchangeRate", { base_quote: { base: "USD", quote: "GBP" } }, { base: "USD", quote: "GBP", rate: 0.79, source: "manual" }, true);
  await up("exchangeRate", { base_quote: { base: "AED", quote: "USD" } }, { base: "AED", quote: "USD", rate: 0.272, source: "manual" }, true);

  // ── Customers ──
  const cust1 = await up("customer", { name: "Jonathan Meyer" }, { customerType: "private", email: "jmeyer@example.com", phone: "+971551234567", countryId: uae.id, city: "Dubai" });
  const cust2 = await up("customer", { name: "Acme Events Ltd" }, { customerType: "corporate", companyName: "Acme Events Ltd", email: "travel@acme-events.com", phone: "+447702345678", countryId: uk.id, city: "London", vip: true });

  // ── Sample leads (skip if any exist) ──
  if ((await prisma.lead.count()) === 0) {
    const lead1 = await prisma.lead.create({ data: {
      source: "Website form", brandId: brand.id, customerId: cust1.id, customerType: "private",
      customerName: "Jonathan Meyer", phone: "+971551234567", email: "jmeyer@example.com",
      countryId: uae.id, city: "Dubai", pickupLocation: "Dubai Marina", dropoffLocation: "Abu Dhabi Corniche",
      travelDate: new Date(Date.now() + 14 * 864e5), passengerCount: 30, luggageDetails: "30 medium cases",
      status: "Assigned", priority: "High", assignedToId: agent1.id, assignedAt: new Date(),
      slaDueAt: new Date(Date.now() + 30 * 60000),
      serviceRequirements: "Return coach, AC, English-speaking driver",
    }});
    await prisma.leadStatusHistory.create({ data: { leadId: lead1.id, toStatus: "Assigned", userId: admin.id } });
    await prisma.serviceLine.create({ data: { leadId: lead1.id, serviceType: "Multi-day charter", pickupLocation: "Dubai Marina", dropoffLocation: "Abu Dhabi Corniche", passengerCount: 30, vehicleRequirement: "50-seat coach", supplierId: supA.id, supplierCost: 2200, customerPrice: 3200, currency: "AED", margin: 31.25 } });

    const lead2 = await prisma.lead.create({ data: {
      source: "WhatsApp", brandId: brand.id, customerId: cust2.id, customerType: "corporate", companyName: "Acme Events Ltd",
      customerName: "Acme Events Ltd", phone: "+447702345678", email: "travel@acme-events.com",
      countryId: uk.id, city: "London", pickupLocation: "Heathrow T5", dropoffLocation: "Central London Hotel",
      travelDate: new Date(Date.now() + 5 * 864e5), passengerCount: 14, status: "Quote Sent", priority: "Urgent",
      assignedToId: agent2.id, assignedAt: new Date(), firstResponseAt: new Date(),
    }});
    await prisma.serviceLine.create({ data: { leadId: lead2.id, serviceType: "Airport transfer", pickupLocation: "Heathrow T5", dropoffLocation: "Central London Hotel", passengerCount: 14, vehicleRequirement: "16-seat minibus", supplierId: supC.id, supplierCost: 180, customerPrice: 280, currency: "GBP", margin: 35.7 } });

    // a confirmed booking with partial payment
    const booking = await prisma.booking.create({ data: {
      leadId: lead2.id, brandId: brand.id, customerId: cust2.id, agentId: agent2.id, supplierId: supC.id,
      countryId: uk.id, city: "London", travelDate: new Date(Date.now() + 5 * 864e5),
      pickupLocation: "Heathrow T5", dropoffLocation: "Central London Hotel", passengerCount: 14,
      customerCurrency: "GBP", supplierCurrency: "GBP", customerInvoiceAmount: 280, customerPaidAmount: 140,
      supplierCost: 180, supplierPaidAmount: 0, grossProfit: 100, margin: 35.7, status: "Awaiting Customer Payment",
    }});
    await prisma.booking.update({ where: { id: booking.id }, data: { bookingRef: `B-${new Date().getFullYear()}-${String(booking.id).padStart(4, "0")}` } });
    await prisma.payment.create({ data: { bookingId: booking.id, party: "customer", direction: "in", amount: 140, currency: "GBP", method: "Bank transfer", status: "Paid", paidAt: new Date(), recordedById: finance.id } });
  }

  console.log("✅ Seed complete (sample data).");
}

// Provision exactly one real administrator without ever exposing or resetting a
// published default. The initial password is supplied out-of-band via
// INITIAL_ADMIN_PASSWORD; if it is absent, a strong random password is generated
// and printed once to the deploy log so it can be rotated on first login. An
// existing admin is never touched, so an operator's password change survives
// every restart.
async function seedAdmin(pw) {
  const email = (process.env.INITIAL_ADMIN_EMAIL || "admin@globalbusrental.com").toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`ℹ️  Admin ${email} already exists — leaving credentials untouched.`);
    return existing;
  }
  let password = process.env.INITIAL_ADMIN_PASSWORD;
  // Security: in production the bootstrap password is NEVER generated-and-printed —
  // deploy logs are not a safe channel. Require INITIAL_ADMIN_PASSWORD to be set as a
  // secret; if it is missing, skip creation loudly rather than leak a password.
  if (!password && process.env.NODE_ENV === "production") {
    console.warn(
      `⚠️  No admin '${email}' exists and INITIAL_ADMIN_PASSWORD is not set. ` +
      `Set it as a Render secret and redeploy — refusing to create an admin with a logged password.`
    );
    return null;
  }
  let generated = false;
  if (!password) {
    // Local/dev convenience only (never reached in production per the guard above).
    password = crypto.randomBytes(15).toString("base64url");
    generated = true;
  }
  const admin = await prisma.user.create({
    data: { name: "System Admin", email, passwordHash: pw(password), role: "ADMIN" },
  });
  if (generated) {
    console.log(
      `\n🔑 Initial admin created (local/dev): ${email}\n   Temporary password (shown once — change it immediately after login):\n   ${password}\n`
    );
  } else {
    console.log(`🔑 Initial admin created: ${email} (password from INITIAL_ADMIN_PASSWORD).`);
  }
  return admin;
}

// idempotent upsert helper. isCompound = where is a compound-unique selector
// (findUnique); otherwise `where` may be any filter (findFirst + update by id).
// Existing-user password hashes are never overwritten so a changed password is
// not silently reset back to a seed value on the next run.
async function up(model, where, data, isCompound = false) {
  const stripSecret = (d) => {
    if (model !== "user") return d;
    const { passwordHash, ...rest } = d;
    return rest;
  };
  if (isCompound) {
    const existing = await prisma[model].findUnique({ where });
    if (existing) return prisma[model].update({ where, data: stripSecret(data) });
    return prisma[model].create({ data });
  }
  const existing = await prisma[model].findFirst({ where });
  if (existing) return prisma[model].update({ where: { id: existing.id }, data: stripSecret(data) });
  return prisma[model].create({ data: { ...where, ...data } });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
