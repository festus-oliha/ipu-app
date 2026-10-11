import "server-only";
import { db } from "./db";
import { memberYearTotals } from "./ledger";
import { memberPosition } from "./loans";
import { currentYear } from "./periods";
import { defaultRecovery } from "./rules";

/** Days the guarantor is given between the default notice and money being taken. */
export const NOTICE_DAYS = 7;

export const owedOf = (p: { principal: bigint; interestOwed: bigint }) => p.principal + (p.interestOwed > 0n ? p.interestOwed : 0n);

/** Works out what recovery would take today: borrower's savings first, then the guarantor's. */
export async function recoveryPlan(loanId: string) {
  const loan = await db.loan.findUnique({ where: { id: loanId }, include: { borrower: true, guarantor: true } });
  const year = await currentYear();
  if (!loan || !year) return null;
  const [p, b, g, notice] = await Promise.all([
    memberPosition(loan.borrowerId),
    memberYearTotals(loan.borrowerId, year),
    loan.guarantorId ? memberYearTotals(loan.guarantorId, year) : Promise.resolve({ savings: 0n }),
    db.auditLog.findFirst({ where: { action: "loan.default", recordId: loan.id }, orderBy: { at: "desc" } }),
  ]);
  const owed = owedOf(p);
  const r = defaultRecovery({ owed, borrowerContributions: b.savings > 0n ? b.savings : 0n, guarantorContributions: g.savings > 0n ? g.savings : 0n });
  const allowedFrom = notice ? new Date(notice.at.getTime() + NOTICE_DAYS * 864e5) : null;
  return { loan, position: p, owed, ...r, allowedFrom };
}

