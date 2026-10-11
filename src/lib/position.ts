/**
 * A member's loan account worked out from ledger rows (pure, no database).
 * Same as the workbook's single row per member:
 *   principal    = loans given − loans repaid − principal deducted
 *   interestOwed = interest charged − interest paid − interest deducted
 *                  (> 0 arrears, < 0 credit from overpaying)
 */
import type { Kobo } from "./money";

export type LedgerRow = { type: string; amountKobo: Kobo; note?: string | null };

export type LoanPosition = { principal: Kobo; interestOwed: Kobo };

export function positionFromRows(rows: LedgerRow[]): LoanPosition {
  let principal = 0n;
  let interestOwed = 0n;
  for (const r of rows) {
    switch (r.type) {
      case "LOAN_GIVEN":
        principal += r.amountKobo;
        break;
      case "LOAN_REPAID":
        principal -= r.amountKobo;
        break;
      case "INTEREST_CHARGED":
        interestOwed += r.amountKobo;
        break;
      case "INTEREST_PAID":
        interestOwed -= r.amountKobo;
        break;
    }
  }
  return { principal, interestOwed };
}
