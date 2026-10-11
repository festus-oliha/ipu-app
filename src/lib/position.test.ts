import { describe, expect, it } from "vitest";
import { positionFromRows } from "./position";
import { closeLoanMonth, monthlyInterest } from "./rules";

const N = (naira: number) => BigInt(Math.round(naira * 100));
type Row = { type: string; amountKobo: bigint };

/**
 * Replays a loan month by month the way the app does it: payments are ledger
 * rows, and each month close posts INTEREST_CHARGED on the closing balance.
 * The result must equal the calculation engine (closeLoanMonth) and the workbook.
 */
function replay(months: { given?: number; interestPaid?: number; repaid?: number }[]) {
  const ledger: Row[] = [];
  const nextOwed: bigint[] = [];
  for (const m of months) {
    if (m.given) ledger.push({ type: "LOAN_GIVEN", amountKobo: N(m.given) });
    if (m.interestPaid) ledger.push({ type: "INTEREST_PAID", amountKobo: N(m.interestPaid) });
    if (m.repaid) ledger.push({ type: "LOAN_REPAID", amountKobo: N(m.repaid) });
    const { principal } = positionFromRows(ledger);
    ledger.push({ type: "INTEREST_CHARGED", amountKobo: monthlyInterest(principal) }); // month close
    nextOwed.push(positionFromRows(ledger).interestOwed);
  }
  return { ledger, nextOwed, final: positionFromRows(ledger) };
}

describe("loan account from the ledger matches the workbook", () => {
  it("Mrs Enotieomwan 2025: K = 5,000 · 4,500 · 3,500 · 2,000 · 0", () => {
    const r = replay([
      { given: 200000 },
      { interestPaid: 5000, repaid: 20000 },
      { interestPaid: 5000, repaid: 20000 },
      { interestPaid: 5000, repaid: 20000 },
      { interestPaid: 5000, repaid: 20000 },
    ]);
    expect(r.nextOwed).toEqual([N(5000), N(4500), N(3500), N(2000), N(0)]);
    expect(r.final.principal).toBe(N(120000));
  });

  it("Mr Austin 2025: arrears add up, never compounded: 3,750 · 7,500 · 9,375", () => {
    expect(replay([{ given: 150000 }, {}, { repaid: 75000 }]).nextOwed).toEqual([N(3750), N(7500), N(9375)]);
  });

  it("agrees with the calculation engine month by month", () => {
    const months = [{ given: 300000 }, { interestPaid: 2000 }, { interestPaid: 9000, repaid: 100000 }, { given: 50000 }];
    const r = replay(months);
    let pos = { principal: 0n, interestOwed: 0n };
    months.forEach((m, i) => {
      const res = closeLoanMonth(pos, { given: m.given ? N(m.given) : 0n, interestPaid: m.interestPaid ? N(m.interestPaid) : 0n, principalRepaid: m.repaid ? N(m.repaid) : 0n });
      expect(res.nextInterestOwed).toBe(r.nextOwed[i]);
      pos = { principal: res.closing, interestOwed: res.nextInterestOwed };
    });
  });

  it("other entry types do not touch the loan account", () => {
    expect(positionFromRows([{ type: "CONTRIBUTION", amountKobo: N(10000) }, { type: "MEMBERSHIP_FEE", amountKobo: N(500) }])).toEqual({ principal: 0n, interestOwed: 0n });
  });

  it("money taken from savings clears the loan; a refunded credit brings interest back to zero", () => {
    expect(
      positionFromRows([
        { type: "LOAN_GIVEN", amountKobo: N(100000) },
        { type: "INTEREST_CHARGED", amountKobo: N(2500) },
        { type: "LOAN_DEDUCTED", amountKobo: N(100000) },
        { type: "INTEREST_DEDUCTED", amountKobo: N(2500) },
      ]),
    ).toEqual({ principal: 0n, interestOwed: 0n });
    expect(
      positionFromRows([
        { type: "INTEREST_CHARGED", amountKobo: N(2500) },
        { type: "INTEREST_PAID", amountKobo: N(4000) },
        { type: "CREDIT_REFUNDED", amountKobo: N(1500) },
      ]),
    ).toEqual({ principal: 0n, interestOwed: 0n });
  });
});
