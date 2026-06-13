import { prisma } from "./db";

// Supplier scoring (Module 8). Combines response speed, acceptance rate,
// reliability (cancellations/complaints), and the manual manager rating into a
// single 0-100 score. Recomputed on demand / after broadcast responses.
export async function recomputeSupplierScore(supplierId: number) {
  const requests = await prisma.supplierQuoteRequest.findMany({ where: { supplierId } });
  const responded = requests.filter((r) => r.respondedAt);
  const accepted = requests.filter((r) => r.outcome === "Accepted");

  const avgResponseMins =
    responded.length > 0
      ? Math.round(responded.reduce((s, r) => s + (r.responseMins || 0), 0) / responded.length)
      : null;
  const acceptanceRate = requests.length > 0 ? accepted.length / requests.length : null;

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return null;

  // sub-scores (each 0-100)
  const speedScore =
    avgResponseMins == null ? 50 : Math.max(0, 100 - Math.min(100, (avgResponseMins / 120) * 100)); // 0min=100, 120min=0
  const acceptScore = acceptanceRate == null ? 50 : acceptanceRate * 100;
  const reliability = Math.max(0, 100 - supplier.cancellationCount * 10 - supplier.complaintCount * 15);
  const ratingScore = (supplier.rating || 0) * 20; // 0-5 -> 0-100

  const score =
    Math.round((speedScore * 0.3 + acceptScore * 0.3 + reliability * 0.2 + ratingScore * 0.2) * 10) / 10;

  return prisma.supplier.update({
    where: { id: supplierId },
    data: { avgResponseMins, acceptanceRate, score },
  });
}
