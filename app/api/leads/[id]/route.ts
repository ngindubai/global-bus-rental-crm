import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Rich lead detail with every related collection for the lead workspace page.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const id = Number(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { id: true, name: true } },
      country: { select: { id: true, name: true, currency: true } },
      brand: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, vip: true } },
      serviceLines: { include: { supplier: { select: { id: true, companyName: true } } }, orderBy: { createdAt: "asc" } },
      supplierRequests: {
        include: { supplier: { select: { id: true, companyName: true, score: true, avgResponseMins: true } }, serviceLine: { select: { id: true, serviceType: true } } },
        orderBy: { sentAt: "desc" },
      },
      quotes: { where: { deletedAt: null }, include: { items: true, brand: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      bookings: { where: { deletedAt: null }, select: { id: true, bookingRef: true, status: true, travelDate: true } },
      communications: { include: { user: { select: { name: true } } }, orderBy: { occurredAt: "desc" }, take: 50 },
      callLogs: { orderBy: { startedAt: "desc" }, take: 20 },
      noteEntries: { include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 30 },
      statusHistory: { orderBy: { createdAt: "desc" }, take: 30 },
      tasks: { where: { deletedAt: null }, orderBy: { dueDate: "asc" } },
    },
  });
  if (!lead || lead.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.role === "AGENT" && lead.assignedToId && lead.assignedToId !== session.id) {
    // agents can still view (temporary assistance) but flag it
  }
  return NextResponse.json({ lead });
}
