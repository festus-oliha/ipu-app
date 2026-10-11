import { describe, expect, it } from "vitest";
import { formatNaira, parseNaira } from "./money";
import {
  checkLoanRequest,
  closeLoanMonth,
  defaultRecovery,
  dividend,
  exitPayout,
  monthlyInterest,
  yearEndPayout,
  type LoanPosition,
} from "./rules";

const N = (naira: number) => BigInt(Math.round(naira * 100)); // naira → kobo

/** Run a loan through several months and return each month's result. */
function run(months: Parameters<typeof closeLoanMonth>[1][]) {
  let pos: LoanPosition = { principal: 0n, interestOwed: 0n };
  return months.map((activity) => {
    const r = closeLoanMonth(pos, activity);
    pos = { principal: r.closing, interestOwed: r.nextInterestOwed };
    return r;
  });
}

describe("money", () => {
  it("parses and formats naira", () => {
    expect(parseNaira("₦10,000.50")).toBe(1000050n);
    expect(parseNaira("250000")).toBe(25000000n);
    expect(formatNaira(1000050n)).toBe("₦10,000.50");
    expect(formatNaira(N(1250000), { compact: true })).toBe("₦1,250,000");
    expect(() => parseNaira("ten")).toThrow();
  });
});

describe("monthly interest: ₦25 per ₦1,000", () => {
  it("matches the workbook", () => {
    expect(monthlyInterest(N(250000))).toBe(N(6250));
    expect(monthlyInterest(N(25000))).toBe(N(625));
    expect(monthlyInterest(N(1250))).toBe(N(31.25)); // kept to the kobo
    expect(monthlyInterest(0n)).toBe(0n);
  });
});

describe("Mrs Enotieomwan, 2025 workbook (₦200,000 in March, ₦20,000 a month back)", () => {
  const r = run([
    { given: N(200000) }, // March
    { interestPaid: N(5000), principalRepaid: N(20000) }, // April
    { interestPaid: N(5000), principalRepaid: N(20000) }, // May
    { interestPaid: N(5000), principalRepaid: N(20000) }, // June
    { interestPaid: N(5000), principalRepaid: N(20000) }, // July
  ]);
  it("charges ₦5,000 due by 15 April", () => expect(r[0].nextInterestOwed).toBe(N(5000)));
  it("April: balance ₦180,000, next ₦4,500", () => {
    expect(r[1].closing).toBe(N(180000));
    expect(r[1].nextInterestOwed).toBe(N(4500));
  });
  it("May: overpays ₦500 → credit, next ₦3,500", () => {
    expect(r[2].interestOwedAfterPayment).toBe(-N(500));
    expect(r[2].nextInterestOwed).toBe(N(3500));
  });
  it("June: next ₦2,000 (workbook K33)", () => expect(r[3].nextInterestOwed).toBe(N(2000)));
  it("July: credit builds to ₦3,000, next ₦0", () => {
    expect(r[4].interestOwedAfterPayment).toBe(-N(3000));
    expect(r[4].nextInterestOwed).toBe(N(0));
  });
});

describe("Mr Austin, 2025 workbook (unpaid interest becomes arrears, not compounded)", () => {
  const r = run([
    { given: N(150000) }, // April
    {}, // May: pays nothing
    { principalRepaid: N(75000) }, // June: principal only
  ]);
  it("May: arrears ₦3,750 + new ₦3,750 = ₦7,500", () => expect(r[1].nextInterestOwed).toBe(N(7500)));
  it("June: ₦7,500 arrears + ₦1,875 = ₦9,375", () => expect(r[2].nextInterestOwed).toBe(N(9375)));
});

describe("workbook bugs that must NOT happen", () => {
  it("a credit is kept when the loan is cleared (Mrs Favour lost ₦12,500)", () => {
    const r = closeLoanMonth({ principal: N(50000), interestOwed: -N(6250) }, { interestPaid: N(6250), principalRepaid: N(50000) });
    expect(r.closing).toBe(0n);
    expect(r.nextInterestOwed).toBe(-N(12500)); // still a credit, refunded at year end
  });
  it("arrears survive a top-up with no interest paid", () => {
    const r = closeLoanMonth({ principal: N(500000), interestOwed: N(12500) }, { given: N(100000) });
    expect(r.nextInterestOwed).toBe(N(12500) + N(15000));
  });
});

describe("loan requests", () => {
  const base = { existingBalance: 0n, usualMonthly: N(10000), month: 6, guarantorIsBorrower: false, guarantorActiveGuarantees: 0 };
  it("limit is monthly contribution × 12", () => {
    const c = checkLoanRequest({ ...base, requested: N(120000) });
    expect(c.limit).toBe(N(120000));
    expect(c.isException).toBe(false);
    expect(c.errors).toEqual([]);
  });
  it("above the limit is an exception, not refused", () => {
    expect(checkLoanRequest({ ...base, requested: N(180000) }).isException).toBe(true);
  });
  it("existing balance counts toward the limit", () => {
    expect(checkLoanRequest({ ...base, requested: N(50000), existingBalance: N(100000) }).isException).toBe(true);
  });
  it("no new loans in January or February", () => {
    expect(checkLoanRequest({ ...base, requested: N(10000), month: 1 }).errors).toHaveLength(1);
    expect(checkLoanRequest({ ...base, requested: N(10000), month: 2 }).errors).toHaveLength(1);
  });
  it("a guarantor may back at most two loans", () => {
    expect(checkLoanRequest({ ...base, requested: N(10000), guarantorActiveGuarantees: 2 }).errors).toHaveLength(1);
  });
});

describe("year-end and exit", () => {
  it("dividend needs 4+ months of contributions", () => {
    expect(dividend(N(240000), 420, 12)).toBe(N(10080)); // Mrs Felicia Imade, 2025
    expect(dividend(N(30000), 420, 3)).toBe(0n);
  });
  it("Zeebaby 2025: debtor", () => {
    const p = yearEndPayout({ contributions: N(200000), dividend: N(8400), loanBalance: N(370000), interestOwed: N(78750) });
    expect(p.payout).toBe(-N(240350));
    expect(p.isDebtor).toBe(true);
  });
  it("credit is refunded into the payout", () => {
    const p = yearEndPayout({ contributions: N(60000), dividend: N(2520), loanBalance: N(20000), interestOwed: -N(7000) });
    expect(p.payout).toBe(N(49520)); // Mrs Enotieomwan, workbook Aza_Final
  });
  it("exit pays contributions only, less what is owed", () => {
    expect(exitPayout({ contributions: N(100000), loanBalance: N(30000), interestOwed: N(750) }).payout).toBe(N(69250));
  });
  it("default: borrower's contributions first, then guarantor's", () => {
    expect(defaultRecovery({ owed: N(300000), borrowerContributions: N(120000), guarantorContributions: N(500000) })).toEqual({
      fromBorrower: N(120000),
      fromGuarantor: N(180000),
      stillOwed: 0n,
    });
  });
});
