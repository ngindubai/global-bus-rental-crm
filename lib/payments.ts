import { convert, baseCurrency } from "./currency";

// Recompute a booking's customer/supplier paid totals from its immutable Paid
// payment rows, converting each into the booking currency so mixed-currency
// receipts aggregate correctly, and advance the milestone status. Runs inside a
// Prisma transaction (`tx`) so concurrent posts stay consistent (P1-07).
export async function recomputeBookingPaid(tx: any, bookingId: number) {
  const booking = await tx.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return null;
  const paidRows = await tx.payment.findMany({ where: { bookingId, status: "Paid" } });

  let customerPaid = 0;
  let supplierPaid = 0;
  for (const p of paidRows) {
    const target = (p.party === "customer" ? booking.customerCurrency : booking.supplierCurrency) || baseCurrency();
    const inBooking = await convert(p.amount, p.currency, target);
    const val = isFinite(inBooking) ? inBooking : p.amount;
    if (p.party === "customer") customerPaid += val;
    else supplierPaid += val;
  }
  customerPaid = Math.round(customerPaid * 100) / 100;
  supplierPaid = Math.round(supplierPaid * 100) / 100;

  const patch: any = { customerPaidAmount: customerPaid, supplierPaidAmount: supplierPaid };
  if (customerPaid >= (booking.customerInvoiceAmount || 0) && booking.status === "Awaiting Customer Payment") {
    patch.status = "Customer Paid";
  }
  if (supplierPaid >= (booking.supplierCost || 0) && ["Customer Paid", "Supplier Payment Pending"].includes(patch.status || booking.status)) {
    patch.status = "Supplier Paid";
  }
  await tx.booking.update({ where: { id: bookingId }, data: patch });
  return { customerPaid, supplierPaid, status: patch.status || booking.status };
}
