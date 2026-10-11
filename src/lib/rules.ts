/**
 * IPU calculation engine — the ONLY place the union's money rules live.
 * Pure functions, no database access, fully covered by tests in
 * src/lib/rules.test.ts. See Requirements BR-2, BR-3, BR-6, BR-8 and
 * System Design section 4.
 */
import { type Kobo, mulDivRound, sum } from "./money";

/** Union rule settings. Defaults match the 2025–2026 workbook and the requirements. */
export type Rules = {
  /** Naira of interest per ₦1,000 per month (25 = 2.5 %). */
  interestPer1000: bigint;
  /** Loan limit = usual monthly contribution × this many months. */
  loanLimitMonths: bigint;
  /** Months (1–12) in which new loans may be given. */
  loanMonths: number[];
  /** Max active loans one person may guarantee. */
  maxGuarantees: number;
  /** Months of contributions needed to share in the dividend. */
  dividendMinMonths: number;
};

export const DEFAULT_RULES: Rules = {
  interestPer1000: 25n,
  loanLimitMonths: 12n,
  loanMonths: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], // March–December
  maxGuarantees: 2,
  dividendMinMonths: 4,
};

/** Interest charged for one month on a balance: balance ÷ 1,000 × 25, to the kobo. */
export function monthlyInterest(balance: Kobo, rules: Rules = DEFAULT_RULES): Kobo {
  if (balance <= 0n) return 0n;
  return mulDivRound(balance, rules.interestPer1000, 1000n);
}

/** A loan's position at the start of a month. */
export type LoanPosition = {
  /** Principal still owed. */
  principal: Kobo;
  /**
   * Interest owed going into the month (includes the charge due by the 15th).
   * Positive = owed / arrears, negative = credit from overpayment.
   */
  interestOwed: Kobo;
};

/** What happened on the loan during the month. */
export type MonthActivity = {
  given?: Kobo; // new loan or top-up paid out this month
  interestPaid?: Kobo;
  principalRepaid?: Kobo;
};

export type MonthResult = {
  opening: Kobo;
  interestDue: Kobo;
  interestPaid: Kobo;
  /** After this month's payment: > 0 arrears, < 0 credit (workbook column H). */
  interestOwedAfterPayment: Kobo;
  given: Kobo;
  principalRepaid: Kobo;
  /** Workbook column J. */
  closing: Kobo;
  /** Interest charged on the closing balance, due by the 15th of next month. */
  charge: Kobo;
  /** Total due by the 15th of next month = arrears/credit + charge (workbook column K). */
  nextInterestOwed: Kobo;
};

/**
 * Close one month for one loan. Matches the workbook (K = J × 2.5 % + H)
 * but never drops arrears on a top-up and never wipes a credit.
 */
export function closeLoanMonth(
  start: LoanPosition,
  activity: MonthActivity,
  rules: Rules = DEFAULT_RULES,
): MonthResult {
  const given = activity.given ?? 0n;
  const interestPaid = activity.interestPaid ?? 0n;
  const principalRepaid = activity.principalRepaid ?? 0n;
  if (given < 0n || interestPaid < 0n || principalRepaid < 0n) {
    throw new Error("Amounts must not be negative");
  }
  if (principalRepaid > start.principal + given) {
    throw new Error("Principal repaid is more than the loan balance");
  }

  const interestOwedAfterPayment = start.interestOwed - interestPaid;
  const closing = start.principal + given - principalRepaid;
  const charge = monthlyInterest(closing, rules);

  return {
    opening: start.principal,
    interestDue: start.interestOwed,
    interestPaid,
    interestOwedAfterPayment,
    given,
    principalRepaid,
    closing,
    charge,
    nextInterestOwed: interestOwedAfterPayment + charge,
  };
}

// ───────────── Loan requests (BR-2) ─────────────

export type LoanRequestCheck = {
  limit: Kobo;
  /** Requested + existing balance is above the limit → needs President/Treasurer exception. */
  isException: boolean;
  /** Hard stops: the request cannot be submitted. */
  errors: string[];
};

export function loanLimit(usualMonthly: Kobo, rules: Rules = DEFAULT_RULES): Kobo {
  return usualMonthly * rules.loanLimitMonths;
}

export function checkLoanRequest(
  input: {
    requested: Kobo;
    existingBalance: Kobo;
    usualMonthly: Kobo;
    /** Calendar month of the request, 1–12. */
    month: number;
    guarantorIsBorrower: boolean;
    guarantorActiveGuarantees: number;
  },
  rules: Rules = DEFAULT_RULES,
): LoanRequestCheck {
  const errors: string[] = [];
  if (input.requested <= 0n) errors.push("Enter the amount you want to borrow.");
  if (!rules.loanMonths.includes(input.month)) {
    errors.push("New loans are given from March to December only.");
  }
  if (input.guarantorIsBorrower) errors.push("You cannot be your own guarantor.");
  if (input.guarantorActiveGuarantees >= rules.maxGuarantees) {
    errors.push(`This guarantor already backs ${rules.maxGuarantees} loans.`);
  }
  const limit = loanLimit(input.usualMonthly, rules);
  const isException = input.requested + input.existingBalance > limit;
  return { limit, isException, errors };
}

// ───────────── Year-end (BR-6) and exit (BR-8) ─────────────

export function qualifiesForDividend(monthsContributed: number, rules: Rules = DEFAULT_RULES) {
  return monthsContributed >= rules.dividendMinMonths;
}

/** Dividend = contributions × rate. Rate in basis points (420 = 4.20 %). */
export function dividend(contributions: Kobo, rateBps: number, monthsContributed: number, rules: Rules = DEFAULT_RULES): Kobo {
  if (!qualifiesForDividend(monthsContributed, rules)) return 0n;
  return mulDivRound(contributions, BigInt(rateBps), 10000n);
}

export type Payout = {
  contributions: Kobo;
  dividend: Kobo;
  credit: Kobo;
  loanDeducted: Kobo;
  interestDeducted: Kobo;
  payout: Kobo;
  isDebtor: boolean;
};

/** Payout = contributions + dividend + credit − loan balance − interest owed. */
export function yearEndPayout(input: {
  contributions: Kobo;
  dividend: Kobo;
  loanBalance: Kobo;
  /** > 0 arrears, < 0 credit. */
  interestOwed: Kobo;
}): Payout {
  const credit = input.interestOwed < 0n ? -input.interestOwed : 0n;
  const interestDeducted = input.interestOwed > 0n ? input.interestOwed : 0n;
  const payout = input.contributions + input.dividend + credit - input.loanBalance - interestDeducted;
  return {
    contributions: input.contributions,
    dividend: input.dividend,
    credit,
    loanDeducted: input.loanBalance,
    interestDeducted,
    payout,
    isDebtor: payout < 0n,
  };
}

/** Exit: contributions back, no dividend, anything owed deducted first. */
export function exitPayout(input: { contributions: Kobo; loanBalance: Kobo; interestOwed: Kobo }): Payout {
  return yearEndPayout({ ...input, dividend: 0n });
}

/**
 * What is actually posted when settling (year end or exit): the overpaid-interest
 * credit is refunded, then interest owed and then the loan are taken from the
 * money available (contributions + dividend + credit). Whatever cannot be
 * covered stays owed ("shortfall") — a debtor pays it up or carries it over.
 */
export function settle(input: { contributions: Kobo; dividend: Kobo; principal: Kobo; interestOwed: Kobo }) {
  const credit = input.interestOwed < 0n ? -input.interestOwed : 0n;
  const interest = input.interestOwed > 0n ? input.interestOwed : 0n;
  const principal = input.principal > 0n ? input.principal : 0n;
  let available = input.contributions + input.dividend + credit;
  const interestDeducted = interest < available ? interest : available;
  available -= interestDeducted;
  const loanDeducted = principal < available ? principal : available;
  available -= loanDeducted;
  return {
    credit,
    interestDeducted,
    loanDeducted,
    payout: available,
    shortfall: interest - interestDeducted + (principal - loanDeducted),
  };
}

/**
 * Default recovery (BR-2): borrower's contributions first, then the guarantor's,
 * up to what is still owed.
 */
export function defaultRecovery(input: { owed: Kobo; borrowerContributions: Kobo; guarantorContributions: Kobo }) {
  const fromBorrower = input.owed < input.borrowerContributions ? input.owed : input.borrowerContributions;
  const left = input.owed - fromBorrower;
  const fromGuarantor = left < input.guarantorContributions ? left : input.guarantorContributions;
  return { fromBorrower, fromGuarantor, stillOwed: left - fromGuarantor };
}

export const totalOf = sum;
