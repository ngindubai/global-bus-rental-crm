import { prisma } from "./db";
import { SLA_MINUTES } from "./constants";

// Lead assignment (Module 3): country specialist > website/brand > round-robin.
// Returns a userId or null (unassigned → manual triage).
export async function pickOwner(opts: {
  countryId?: number | null;
  brandId?: number | null;
  source?: string | null;
}): Promise<number | null> {
  // 1) Country specialist — an active AGENT/MANAGER whose countryId matches.
  if (opts.countryId) {
    const specialist = await prisma.user.findFirst({
      where: { active: true, countryId: opts.countryId, role: { in: ["AGENT", "MANAGER"] } },
      orderBy: { id: "asc" },
    });
    if (specialist) return specialist.id;
  }

  // 2) Round-robin across active agents — fewest open leads wins.
  const agents = await prisma.user.findMany({
    where: { active: true, role: "AGENT" },
    select: { id: true },
  });
  if (agents.length === 0) return null;

  const counts = await Promise.all(
    agents.map(async (a) => ({
      id: a.id,
      open: await prisma.lead.count({
        where: {
          assignedToId: a.id,
          deletedAt: null,
          status: { notIn: ["Won / Confirmed", "Lost", "Cancelled", "Duplicate / Invalid"] },
        },
      }),
    }))
  );
  counts.sort((a, b) => a.open - b.open);
  return counts[0].id;
}

export function slaDueAt(priority?: string | null, from = new Date()): Date {
  const mins = SLA_MINUTES[priority || "Medium"] ?? 60;
  return new Date(from.getTime() + mins * 60 * 1000);
}
