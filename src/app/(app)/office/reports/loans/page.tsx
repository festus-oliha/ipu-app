import type { Metadata } from "next";
import { Letterhead } from "@/components/Letterhead";
import { PrintButton } from "@/components/PrintButton";
import { OFFICER_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { LOAN_STATUS_LABELS, positionsThrough } from "@/lib/loans";
import { formatNaira } from "@/lib/money";
import { currentYear, formatDate, todayLagos } from "@/lib/periods";

export const metadata: Metadata = { title: "Loan book" };

export default async function LoanBookPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireRole(...OFFICER_ROLES);
  const { year: label } = await searchParams;
  const year = (label ? await db.financialYear.findUnique({ where: { label } }) : null) ?? (await currentYear());
  if (!year) return <p>No year.</p>;
  const loans = await db.loan.findMany({
    where: { status: { in: ["DISBURSED", "DEFAULTED", "CLOSED"] }, disbursedOn: { lte: year.endDate }, OR: [{ closedAt: null }, { closedAt: { gte: year.startDate } }] },
    include: { borrower: true, guarantor: true },
    orderBy: { disbursedOn: "asc" },
  });
  const positions = await positionsThrough(new Date(Date.UTC(2100, 0, 1)));
  const totalLent = loans.filter((l) => l.disbursedOn && l.disbursedOn >= year.startDate).reduce((t, l) => t + l.amountKobo, 0n);
  // A member has one loan account: show the balance once, on their latest loan.
  const rows = loans.map((l) => ({
    l,
    p: positions.get(l.borrowerId) ?? { principal: 0n, interestOwed: 0n },
    latest: !loans.some((o) => o.borrowerId === l.borrowerId && o.id !== l.id && ((o.disbursedOn?.getTime() ?? 0) > (l.disbursedOn?.getTime() ?? 0) || ((o.disbursedOn?.getTime() ?? 0) === (l.disbursedOn?.getTime() ?? 0) && o.id > l.id))),
  }));
  const outstanding = rows.filter((r) => r.latest).reduce((t, r) => t + r.p.principal, 0n);
  const interest = rows.filter((r) => r.latest).reduce((t, r) => t + (r.p.interestOwed > 0n ? r.p.interestOwed : 0n), 0n);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end print:hidden"><PrintButton /></div>
      <article className="rounded-xl border border-line bg-white p-5 print:border-0 print:p-0">
        <Letterhead title={`Loan book ${year.label}`} subtitle={`Balances as at ${formatDate(new Date(`${todayLagos()}T00:00:00Z`))}`} />
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[48rem] text-left text-xs print:min-w-0 print:text-[9pt]">
            <thead>
              <tr className="border-b-2 border-forest">
                {["Borrower", "Guarantor", "Amount", "Paid out", "Status", "Balance now", "Interest owed"].map((c, i) => <th key={c} className={`px-2 py-2 font-semibold ${i > 1 ? "text-right" : ""}`}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ l, p, latest }) => {
                return (
                  <tr key={l.id} className="border-t border-line">
                    <td className="px-2 py-1.5">{l.borrower.memberNo} {l.borrower.fullName}{l.isException ? " (exception)" : ""}</td>
                    <td className="px-2 py-1.5">{l.guarantor.fullName}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatNaira(l.amountKobo, { compact: true })}</td>
                    <td className="px-2 py-1.5 text-right">{l.disbursedOn ? formatDate(l.disbursedOn) : ""}</td>
                    <td className="px-2 py-1.5 text-right">{LOAN_STATUS_LABELS[l.status]}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{latest ? formatNaira(p.principal, { compact: true }) : "↓"}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${latest && p.interestOwed > 0n ? "text-danger" : ""}`}>{latest ? (p.interestOwed > 0n ? formatNaira(p.interestOwed, { compact: true }) : "–") : ""}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-forest font-semibold">
                <th colSpan={2} className="px-2 py-2 text-left">{loans.length} loans · lent this year {formatNaira(totalLent, { compact: true })}</th>
                <td colSpan={3} />
                <td className="px-2 py-2 text-right tabular-nums">{formatNaira(outstanding, { compact: true })}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatNaira(interest, { compact: true })}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-4 text-xs text-muted">Each member has one loan account; a top-up adds to the same balance, so the balance is shown on the member&apos;s latest loan.</p>
      </article>
    </div>
  );
}
