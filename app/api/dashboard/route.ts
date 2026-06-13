import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { LEAD_OPEN_STATUSES } from "@/lib/constants";

export const dynamic = "force-dynamic";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const today = startOfToday();
  const month = startOfMonth();
  const in7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date();

  const [
    newLeadsToday,
    waitingResponse,
    slaBreaches,
    missedCalls,
    outstandingQuotes,
    awaitingSupplier,
    awaitingCustomer,
    bookingsToday,
    bookingsNext7,
    wonThisMonth,
    openAlerts,
  ] = await Promise.all([
    prisma.lead.count({ where: { deletedAt: null, createdAt: { gte: today } } }),
    prisma.lead.count({ where: { deletedAt: null, firstResponseAt: null, status: { in: LEAD_OPEN_STATUSES } } }),
    prisma.lead.count({ where: { deletedAt: null, firstResponseAt: null, slaDueAt: { lt: now }, status: { in: LEAD_OPEN_STATUSES } } }),
    prisma.callLog.count({ where: { direction: "missed", createdAt: { gte: today } } }),
    prisma.quote.count({ where: { deletedAt: null, status: "Sent" } }),
    prisma.supplierQuoteRequest.count({ where: { respondedAt: null, outcome: "Pending" } }),
    prisma.lead.count({ where: { deletedAt: null, status: "Awaiting Customer Information" } }),
    prisma.booking.count({ where: { deletedAt: null, travelDate: { gte: today, lt: new Date(today.getTime() + 86400000) } } }),
    prisma.booking.count({ where: { deletedAt: null, travelDate: { gte: now, lt: in7 } } }),
    prisma.lead.count({ where: { deletedAt: null, status: "Won / Confirmed", updatedAt: { gte: month } } }),
    prisma.alert.count({ where: { resolvedAt: null } }),
  ]);

  // sales / profit
  const bookingsMonth = await prisma.booking.findMany({
    where: { deletedAt: null, createdAt: { gte: month } },
    select: { customerInvoiceAmount: true, grossProfit: true, createdAt: true },
  });
  const bookingsTodayRows = bookingsMonth.filter((b) => b.createdAt >= today);
  const revenueMonth = sum(bookingsMonth.map((b) => b.customerInvoiceAmount));
  const revenueToday = sum(bookingsTodayRows.map((b) => b.customerInvoiceAmount));
  const profitMonth = sum(bookingsMonth.map((b) => b.grossProfit));
  const profitToday = sum(bookingsTodayRows.map((b) => b.grossProfit));
  const avgBookingValue = bookingsMonth.length ? Math.round(revenueMonth / bookingsMonth.length) : 0;

  const quotesSentMonth = await prisma.quote.count({ where: { deletedAt: null, sentAt: { gte: month } } });
  const conversion = quotesSentMonth ? Math.round((wonThisMonth / quotesSentMonth) * 100) : 0;

  // agent performance
  const agents = await prisma.user.findMany({ where: { role: { in: ["AGENT", "MANAGER"] }, active: true }, select: { id: true, name: true, online: true } });
  const agentPerf = await Promise.all(
    agents.map(async (a) => {
      const [leadsHandled, quotesSent, bookingsWon] = await Promise.all([
        prisma.lead.count({ where: { assignedToId: a.id, deletedAt: null } }),
        prisma.quote.count({ where: { createdById: a.id, deletedAt: null, sentAt: { gte: month } } }),
        prisma.booking.count({ where: { agentId: a.id, deletedAt: null, createdAt: { gte: month } } }),
      ]);
      const bk = await prisma.booking.findMany({ where: { agentId: a.id, deletedAt: null, createdAt: { gte: month } }, select: { customerInvoiceAmount: true, grossProfit: true } });
      return {
        id: a.id, name: a.name, online: a.online,
        leadsHandled, quotesSent, bookingsWon,
        revenue: sum(bk.map((b) => b.customerInvoiceAmount)),
        profit: sum(bk.map((b) => b.grossProfit)),
      };
    })
  );

  // country breakdown
  const countries = await prisma.country.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
  const countryPerf = await Promise.all(
    countries.map(async (c) => {
      const leads = await prisma.lead.count({ where: { countryId: c.id, deletedAt: null } });
      const bk = await prisma.booking.findMany({ where: { countryId: c.id, deletedAt: null }, select: { customerInvoiceAmount: true, grossProfit: true } });
      return { id: c.id, name: c.name, leads, revenue: sum(bk.map((b) => b.customerInvoiceAmount)), profit: sum(bk.map((b) => b.grossProfit)) };
    })
  );

  // suppliers
  const topSuppliers = await prisma.supplier.findMany({
    where: { deletedAt: null }, orderBy: { score: "desc" }, take: 6,
    select: { id: true, companyName: true, score: true, avgResponseMins: true, cancellationCount: true },
  });

  // finance
  const unpaidBookings = await prisma.booking.findMany({
    where: { deletedAt: null, status: { notIn: ["Cancelled", "Closed"] } },
    select: { customerInvoiceAmount: true, customerPaidAmount: true, supplierCost: true, supplierPaidAmount: true },
  });
  const customerOutstanding = sum(unpaidBookings.map((b) => (b.customerInvoiceAmount || 0) - (b.customerPaidAmount || 0)));
  const supplierOutstanding = sum(unpaidBookings.map((b) => (b.supplierCost || 0) - (b.supplierPaidAmount || 0)));

  // unpaid before travel (risk)
  const travelSoon = await prisma.booking.findMany({
    where: { deletedAt: null, travelDate: { gte: now, lt: in7 }, status: { notIn: ["Cancelled", "Closed"] } },
    select: { id: true, bookingRef: true, travelDate: true, customerInvoiceAmount: true, customerPaidAmount: true, supplierCost: true, supplierPaidAmount: true, city: true },
  });
  const customerUnpaidSoon = travelSoon.filter((b) => (b.customerPaidAmount || 0) < (b.customerInvoiceAmount || 0));
  const supplierUnpaidSoon = travelSoon.filter((b) => (b.supplierPaidAmount || 0) < (b.supplierCost || 0));

  return NextResponse.json({
    live: {
      newLeadsToday, waitingResponse, slaBreaches, missedCalls, outstandingQuotes,
      awaitingSupplier, awaitingCustomer, bookingsToday, bookingsNext7, openAlerts,
    },
    sales: { revenueToday, revenueMonth, profitToday, profitMonth, avgBookingValue, conversion, wonThisMonth },
    agents: agentPerf.sort((a, b) => b.profit - a.profit),
    countries: countryPerf.sort((a, b) => b.revenue - a.revenue),
    suppliers: topSuppliers,
    finance: {
      customerOutstanding, supplierOutstanding,
      customerUnpaidSoon: customerUnpaidSoon.map((b) => ({ id: b.id, ref: b.bookingRef, travelDate: b.travelDate, city: b.city, due: (b.customerInvoiceAmount || 0) - (b.customerPaidAmount || 0) })),
      supplierUnpaidSoon: supplierUnpaidSoon.map((b) => ({ id: b.id, ref: b.bookingRef, travelDate: b.travelDate, city: b.city, due: (b.supplierCost || 0) - (b.supplierPaidAmount || 0) })),
    },
  });
}

function sum(arr: (number | null | undefined)[]) {
  return Math.round(arr.reduce((s: number, n) => s + (n || 0), 0) * 100) / 100;
}
