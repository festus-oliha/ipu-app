import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Letterhead } from "@/components/Letterhead";
import { PrintButton } from "@/components/PrintButton";
import { Notice } from "@/components/ui";
import { OFFICER_ROLES, hasRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { owedOf } from "@/lib/debtors";
import { settingsAt } from "@/lib/settings";
import { type LetterKind, fullName, lettersFor, officeHolders } from "@/lib/documents";
import { officerNames } from "@/lib/ledger";
import { memberPosition } from "@/lib/loans";
import { formatNaira } from "@/lib/money";
import { formatDate, todayLagos } from "@/lib/periods";
import { monthlyInterest } from "@/lib/rules";

export const metadata: Metadata = { title: "Loan letter" };

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function Sign({ who, name, date }: { who: string; name: string; date?: string }) {
  return (
    <div className="break-inside-avoid">
      <div className="h-12 border-b border-ink/60 print:h-9" />
      <p className="mt-1 text-sm font-semibold">{name || " "}</p>
      <p className="text-xs text-muted">{who}{date ? ` · ${date}` : " · Date: ____________"}</p>
    </div>
  );
}

export default async function LoanLetterPage({ params, searchParams }: { params: Promise<{ loanId: string }>; searchParams: Promise<{ letter?: string }> }) {
  const user = await requireUser();
  const { loanId } = await params;
  const { letter } = await searchParams;
  const loan = await db.loan.findUnique({ where: { id: loanId }, include: { borrower: true, guarantor: true, approvals: { orderBy: { at: "asc" } } } });
  if (!loan) notFound();
  const isOfficer = hasRole(user, ...OFFICER_ROLES);
  if (user.member?.id !== loan.borrowerId && user.member?.id !== loan.guarantorId && !isOfficer) notFound();

  const available = lettersFor(loan.status);
  const kind = (available.find((l) => l.kind === letter) ?? available[0])?.kind;
  if (!kind) return <Notice tone="warning">Letters are available once a loan has been approved.</Notice>;

  const [signers, names, position, year, defaultMark] = await Promise.all([
    officeHolders(),
    officerNames(loan.approvals.map((a) => a.byId)),
    memberPosition(loan.borrowerId),
    db.financialYear.findFirst({ where: { startDate: { lte: loan.disbursedOn ?? new Date() }, endDate: { gte: loan.disbursedOn ?? new Date() } } }),
    db.auditLog.findFirst({ where: { action: "loan.default", recordId: loan.id }, orderBy: { at: "desc" } }),
  ]);
  const borrower = fullName(loan.borrower);
  const guarantor = loan.guarantor ? fullName(loan.guarantor) : null;
  const ref = `IPU/LN/${loan.borrower.memberNo.replace("IPU-", "")}/${(loan.disbursedOn ?? loan.createdAt).getUTCFullYear()}/${loan.id.slice(-4).toUpperCase()}`;
  const today = day(new Date(`${todayLagos()}T00:00:00Z`));
  const approved = (step: string) => loan.approvals.find((a) => a.step === step && a.decision === "APPROVED");
  const pres = approved("PRESIDENT");
  const treas = approved("TREASURER");
  const guar = approved("GUARANTOR");
  const yearEnd = year ? day(year.endDate) : "the end of February";
  const rules = await settingsAt();
  const NOTICE_DAYS = rules.noticeDays;
  const per1000 = String(rules.interestPer1000);
  const perMonth = monthlyInterest(loan.amountKobo, rules);
  const titles: Record<LetterKind, string> = { agreement: "Loan agreement", clearance: "Loan clearance letter", notice: "Notice of default" };

  return (
    <div className="flex flex-col gap-4">
      <style>{`@media print { @page { size: A4 portrait; margin: 16mm 18mm; } }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/loans/${loan.id}`} className="text-sm text-forest underline">← Back to the loan</Link>
        <div className="flex flex-wrap items-center gap-2">
          {available.length > 1 ? available.map((l) => (
            <Link key={l.kind} href={`?letter=${l.kind}`} aria-current={l.kind === kind ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${l.kind === kind ? "bg-forest text-ivory" : "border border-line bg-white"}`}>{l.label}</Link>
          )) : null}
          <PrintButton />
        </div>
      </div>

      <article className="mx-auto w-full max-w-[52rem] rounded-xl border border-line bg-white p-6 text-[15px] leading-relaxed sm:p-10 print:max-w-none print:border-0 print:p-0 print:text-[10pt] print:leading-snug">
        <Letterhead title={titles[kind]} subtitle={`Ref: ${ref} · ${today}`} />

        <p className="font-semibold">{borrower}</p>
        <p className="text-sm text-muted">Member no. {loan.borrower.memberNo}{loan.borrower.address ? ` · ${loan.borrower.address}` : ""}</p>
        {kind !== "agreement" && guarantor ? <p className="mt-1 text-sm text-muted">Copy: {guarantor} (guarantor, {loan.guarantor!.memberNo})</p> : null}

        {kind === "agreement" ? (
          <div className="mt-5 flex flex-col gap-4 print:mt-3 print:gap-2.5">
            <p>Dear {borrower},</p>
            <p>
              The Iyobor Progressive Union has approved your loan of <strong>{formatNaira(loan.amountKobo)}</strong>
              {loan.purpose && !loan.purpose.startsWith("Imported") ? <> for <em>{loan.purpose}</em></> : null}
              {loan.disbursedOn ? <>, paid to you on <strong>{day(loan.disbursedOn)}</strong>{loan.bankRef ? ` (bank reference ${loan.bankRef})` : ""}</> : null}. The terms are:
            </p>
            <ol className="ml-5 flex list-decimal flex-col gap-2 print:gap-1">
              <li><strong>Interest</strong> is ₦{per1000} for every ₦1,000 still owed at the end of each month ({Number(per1000) / 10}% a month), charged when the month is closed. On the full amount that is {formatNaira(perMonth)} a month; it falls as you repay.</li>
              <li>Each month&apos;s interest is <strong>due by the 15th of the next month</strong>. Interest not paid by then is carried forward as arrears. There is no penalty and no interest on interest. Any interest overpaid is a credit, refunded at year end.</li>
              <li>You may repay any part of the loan at any time, into GT Bank account 0033550876 (Iyobor Progressive Union). Each payment reduces the balance that interest is charged on.</li>
              <li>The loan and any interest owed must be <strong>cleared by {yearEnd}</strong>, the end of the financial year. Anything still owed then is taken from your savings at year-end settlement.</li>
              <li>If you <strong>default</strong>, the union will give {NOTICE_DAYS} days&apos; written notice, then recover the money from your savings first and, if that is not enough, from your guarantor&apos;s savings. The union may also refer the debt for legal action.</li>
            </ol>
            {guarantor ? (
              <section className="break-inside-avoid rounded-lg border border-line p-4 print:p-3">
                <h2 className="font-display text-lg text-forest">Guarantor&apos;s undertaking</h2>
                <p className="mt-1">
                  I, <strong>{guarantor}</strong> ({loan.guarantor!.memberNo}), guarantee this loan. I understand that if {borrower} does not repay,
                  and their savings are not enough, the amount still owed will be taken from my savings with the union after {NOTICE_DAYS} days&apos; notice.
                  {guar ? ` I accepted this in the app on ${formatDate(guar.at)}.` : ""}
                </p>
              </section>
            ) : (
              <p className="text-sm text-muted">This loan was recorded from the union&apos;s workbook with a verbal guarantee.</p>
            )}
            {loan.isException ? <p className="text-sm">This loan is above the usual limit ({String(rules.loanLimitMonths)} times the monthly contribution) and was approved as an exception{loan.exceptionReason ? `: ${loan.exceptionReason}` : ""}.</p> : null}
            <div className="mt-4 grid gap-8 sm:grid-cols-2 print:mt-2 print:grid-cols-2 print:gap-x-10 print:gap-y-5">
              <Sign who="Borrower" name={borrower} />
              {guarantor ? <Sign who="Guarantor" name={guarantor} /> : <span />}
              <Sign who="President" name={pres ? names.get(pres.byId) ?? signers.president : signers.president} date={pres ? `approved ${formatDate(pres.at)}` : undefined} />
              <Sign who="Treasurer" name={treas ? names.get(treas.byId) ?? signers.treasurer : signers.treasurer} date={treas ? `approved ${formatDate(treas.at)}` : undefined} />
            </div>
          </div>
        ) : null}

        {kind === "clearance" ? (
          <div className="mt-5 flex flex-col gap-4 print:mt-3 print:gap-2.5">
            <p>Dear {borrower},</p>
            <p>
              This is to confirm that the loan of <strong>{formatNaira(loan.amountKobo)}</strong>
              {loan.disbursedOn ? <> paid to you on {day(loan.disbursedOn)}</> : null} has been <strong>repaid in full</strong>
              {loan.closedAt ? <>, as at {day(loan.closedAt)}</> : null}, together with the interest due on it.
            </p>
            <p>You owe the union nothing on this loan{guarantor ? <>, and {guarantor} is released from their guarantee</> : null}. Thank you for keeping to the terms.</p>
            {position.principal > 0n ? <p className="text-sm text-muted">Note: you have another loan with a balance of {formatNaira(position.principal)}; this letter covers only the loan above.</p> : null}
            <p className="mt-2">Yours faithfully,</p>
            <div className="grid gap-8 sm:grid-cols-2 print:grid-cols-2">
              <Sign who="Treasurer" name={signers.treasurer} />
              <Sign who="Secretary" name={signers.secretary} />
            </div>
          </div>
        ) : null}

        {kind === "notice" ? (
          <div className="mt-5 flex flex-col gap-4 print:mt-3 print:gap-2.5">
            <p>Dear {borrower},</p>
            <p>
              Your loan of <strong>{formatNaira(loan.amountKobo)}</strong>{loan.disbursedOn ? <> paid to you on {day(loan.disbursedOn)}</> : null} has been
              declared in <strong>default</strong>{defaultMark ? <> on {day(defaultMark.at)}</> : null}.
            </p>
            <table className="w-full max-w-sm text-left">
              <tbody>
                <tr className="border-b border-line"><th className="py-1 font-normal text-muted">Loan balance</th><td className="py-1 text-right font-semibold tabular-nums">{formatNaira(position.principal)}</td></tr>
                <tr className="border-b border-line"><th className="py-1 font-normal text-muted">Interest unpaid</th><td className="py-1 text-right font-semibold tabular-nums">{formatNaira(position.interestOwed > 0n ? position.interestOwed : 0n)}</td></tr>
                <tr><th className="py-1 font-semibold">Total owed today</th><td className="py-1 text-right font-bold tabular-nums">{formatNaira(owedOf(position))}</td></tr>
              </tbody>
            </table>
            <p>
              Please pay this amount into GT Bank account 0033550876 (Iyobor Progressive Union)
              {defaultMark ? <> by <strong>{day(new Date(defaultMark.at.getTime() + NOTICE_DAYS * 864e5))}</strong></> : <> within {NOTICE_DAYS} days of this notice</>}.
            </p>
            <p>
              If it is not paid by then, the union will recover it from your savings with the union and, if they are not enough,
              {guarantor ? <> from the savings of your guarantor, {guarantor}</> : " by other lawful means"}. The union may also refer the debt for legal action.
            </p>
            <p className="mt-2">Yours faithfully,</p>
            <div className="grid gap-8 sm:grid-cols-2 print:grid-cols-2">
              <Sign who="President" name={signers.president} />
              <Sign who="Treasurer" name={signers.treasurer} />
            </div>
          </div>
        ) : null}
      </article>
    </div>
  );
}
