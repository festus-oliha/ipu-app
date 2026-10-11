import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Letterhead } from "@/components/Letterhead";
import { PrintButton } from "@/components/PrintButton";
import { OFFICER_ROLES, hasRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatNaira } from "@/lib/money";
import { currentYear, formatDate, monthLabel, todayLagos } from "@/lib/periods";
import { memberStatement } from "@/lib/statement";

export const metadata: Metadata = { title: "Statement" };

const m = (k: bigint) => (k === 0n ? "–" : formatNaira(k, { compact: true }));
const owed = (k: bigint) => (k === 0n ? "–" : k < 0n ? `${formatNaira(-k, { compact: true })} cr` : formatNaira(k, { compact: true }));

export default async function StatementPage({ params, searchParams }: { params: Promise<{ memberId: string }>; searchParams: Promise<{ year?: string }> }) {
  const user = await requireUser();
  const { memberId } = await params;
  const { year: label } = await searchParams;
  // Members see only their own statement; officers see anyone's.
  if (user.member?.id !== memberId && !hasRole(user, ...OFFICER_ROLES)) notFound();
  const member = await db.member.findUnique({ where: { id: memberId } });
  if (!member) notFound();
  const years = await db.financialYear.findMany({ orderBy: { startDate: "desc" } });
  const year = (label && years.find((y) => y.label === label)) || (await currentYear());
  if (!year) notFound();

  const s = await memberStatement(member.id, year);
  const settlement = await db.settlement.findUnique({ where: { yearId_memberId: { yearId: year.id, memberId: member.id } } });
  const cols = ["Month", "Contribution", "Fee", "Loan given", "Interest charged", "Interest paid", "Loan repaid", "Savings to date", "Loan balance", "Interest owed"];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="Year">
          {years.map((y) => (
            <Link key={y.id} href={`?year=${encodeURIComponent(y.label)}`} aria-current={y.id === year.id ? "page" : undefined}
              className={`rounded-lg px-3 py-2 font-semibold ${y.id === year.id ? "bg-forest text-ivory" : "border border-line bg-white"}`}>{y.label}</Link>
          ))}
        </nav>
        <PrintButton />
      </div>

      <article className="rounded-xl border border-line bg-white p-5 print:border-0 print:p-0">
        <Letterhead title={`Member statement ${year.label}`} subtitle={`${[member.title, member.fullName].filter(Boolean).join(" ")} · ${member.memberNo} · printed ${formatDate(new Date(`${todayLagos()}T00:00:00Z`))}`} />
        {s.broughtForward.principal > 0n || s.broughtForward.interestOwed !== 0n ? (
          <p className="mb-3 text-sm">Brought forward from last year: loan {formatNaira(s.broughtForward.principal)}, interest {owed(s.broughtForward.interestOwed)}.</p>
        ) : null}
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[52rem] text-left text-xs print:min-w-0 print:text-[9pt]">
            <thead className="bg-forest text-ivory print:bg-white print:text-ink">
              <tr>{cols.map((c, i) => <th key={c} scope="col" className={`px-2 py-2 font-semibold print:border-b-2 print:border-forest ${i ? "text-right" : ""}`}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {s.months.map((r) => (
                <tr key={r.month.toISOString()} className="border-t border-line">
                  <td className="px-2 py-1.5">{monthLabel(r.month)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.paidAhead ? "paid ahead" : m(r.contribution)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m(r.membershipFee)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m(r.loanGiven)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m(r.interestCharged)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m(r.interestPaid)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m(r.loanRepaid)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{m(r.savingsToDate)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m(r.loanBalance)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{owed(r.interestOwed)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-forest font-semibold">
                <th scope="row" className="px-2 py-2">Total</th>
                <td className="px-2 py-2 text-right tabular-nums">{m(s.totals.contribution)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{m(s.totals.membershipFee)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{m(s.totals.loanGiven)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{m(s.totals.interestCharged)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{m(s.totals.interestPaid)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{m(s.totals.loanRepaid)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
        {s.totals.takenFromSavings ? <p className="mt-3 text-sm">Taken from savings to clear debts this year: {formatNaira(s.totals.takenFromSavings)}.</p> : null}
        {settlement ? (
          <section className="mt-5 rounded-lg border border-line p-4 text-sm print:break-inside-avoid">
            <h2 className="mb-2 font-display text-lg text-forest">Year-end settlement</h2>
            <p>
              Savings {formatNaira(settlement.contributionsKobo)} + dividend {formatNaira(settlement.dividendKobo)}
              {settlement.creditRefundKobo ? ` + interest credit ${formatNaira(settlement.creditRefundKobo)}` : ""}
              {settlement.interestDeductedKobo ? ` − interest ${formatNaira(settlement.interestDeductedKobo)}` : ""}
              {settlement.loanDeductedKobo ? ` − loan ${formatNaira(settlement.loanDeductedKobo)}` : ""}
              {" = "}
              <span className="font-semibold">{settlement.payoutKobo >= 0n ? `payout ${formatNaira(settlement.payoutKobo)}` : `still owed ${formatNaira(-settlement.payoutKobo)}`}</span>
              {settlement.paidOn ? `, paid ${formatDate(settlement.paidOn)}` : ""}
            </p>
          </section>
        ) : (
          <p className="mt-4 text-sm">
            End of statement: loan balance {formatNaira(s.end.principal)}, interest {s.end.interestOwed === 0n ? formatNaira(0n) : owed(s.end.interestOwed)}. Interest is ₦25 per ₦1,000 a month, due by the 15th of the next month.
          </p>
        )}
        <p className="mt-6 text-xs text-muted">Produced by the IPU app from the union&apos;s records. Questions: the Treasurer, Mrs Felicia Imade.</p>
      </article>
    </div>
  );
}
