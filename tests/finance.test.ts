import { describe, it, expect } from "vitest";
import { profitAndMargin } from "@/lib/currency";

// Finance math is safety-critical (P0-05). These guard the pure calculation used
// across quotes, bookings and reports.
describe("profitAndMargin", () => {
  it("computes profit and margin for a normal job", () => {
    expect(profitAndMargin(180, 280)).toEqual({ profit: 100, margin: 35.71 });
  });
  it("returns zero margin when the customer price is zero (no divide-by-zero)", () => {
    expect(profitAndMargin(100, 0)).toEqual({ profit: -100, margin: 0 });
  });
  it("handles a loss-making line", () => {
    const { profit } = profitAndMargin(300, 250);
    expect(profit).toBe(-50);
  });
  it("rounds to 2 decimal places", () => {
    const { profit } = profitAndMargin(10.005, 20.005);
    expect(profit).toBe(10);
  });
});
