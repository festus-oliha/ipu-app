import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Letterhead } from "@/components/Letterhead";
import { PrintButton } from "@/components/PrintButton";
import { Notice } from "@/components/ui";
import { OFFICER_ROLES, hasRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { owedOf } from "@/lib/debtors";
import { fullName, officeHolders } from "@/lib/documents";
import { memberYearTotals } from "@/lib/ledger";
import { positionsThrough } from "@/lib/loans";
import { formatNaira } from "@/lib/money";
import { notContributing, yearEndNoticeOpen } from "@/lib/notices";
import { currentYear, monthLabel, todayLagos } from "@/lib/periods";
import { settingsAt } from "@/lib/settings";

export const metadata: Metadata = { title: "Notice" };

const FAR = new Date(Date.UTC(2100, 0, 1));
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

function Sign({ who, name }: { who: string; name: string }) {
  return (
    <div className="break-inside-avoid">
      <div className="h-10 border-b border-ink/60" />
      <p className="mt-1 text-sm font-semibold">{name || " "}</p>
      <p className="text-xs text-muted">{who}</p>
    </div>
  );
}

/**
 * Printed notices to a member:
 * - contribution: on loan but no contribution for two months or more;
 * - yearend: what is still owed before the year closes (January and February).
 * memberId "all" prints one page per member who should get it (officers only).
 */
export default async function NoticePage({ params, searchParams }: { params: Promise<{ memberId: string }>; searchParams: Promise<{ kind?: string }> }) {
  const user = await requireUser();
  const { memberId } = await params;
  const { kind: k } = await searchParams;
  const kind = k === "yearend" ? "yearend" : "contribution";
  const isOfficer = hasRole(user, ...OFFICER_ROLES);
  if (memberId === "all" ? !isOfficer : user.member?.id !== memberId && !isOfficer) notFound();

  const today = todayLagos();
  const todayDate = new Date(`${today}T00:00:00Z`);
  const [year, signers, positions, rules] = await Promise.all([currentYear(), officeHolders(), positionsThrough(FAR), settingsAt()]);
  if (!year) return <Notice tone="warning">No open financial year.</Notice>;

  type Page = { member: { id: string; title: string | null; fullName: string; memberNo: string; address: string | null; usualMonthlyKobo: bigint }; months?: Date[]; guarantor?: string | null };
  let pages: Page[] = [];
  if (kind === "contribution") {
    const due = await notContributing(today);
    pages = due.filter((d) => memberId === "all" || d.member.id === memberId).map((d) => ({ member: d.member, months: d.months }));
  } else {
    const ids = [...positions].filter(([, p]) => p.principal > 0n || p.interestOwed > 0n).map(([id]) => id).filter((id) => memberId === "all" || id === memberId);
    const members = await db.member.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, orderBy: { memberNo: "asc" } });
    pages = members.map((member) => ({ member }));
  }
  const loans = await db.loan.findMany({ where: { borrowerId: { in: pages.map((p) => p.member.id) }, status: { in: ["DISBURSED", "DEFAULTED"] } }, include: { guarantor: true }, orderBy: { disbursedOn: "desc" } });
  const totals = new Map(await Promise.all(pages.map(async (p) => [p.member.id, await memberYearTotals(p.member.id, year)] as const)));

  const back = memberId === "all" ? "/office/debtors" : isOfficer ? `/office/members/${memberId}` : "/";
  const title = kind === "contribution" ? "Notice: contributions not paid" : "Year-end notice: amount still owed";
  const payBy = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + 1, 0)); // end of this month

  return (
    <div className="flex flex-col gap-4">
      <style>{`@media print { @page { size: A4 portrait; margin: 16mm 18mm; } }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={back} className="text-sm text-forest underline">← Back</Link>
        {pages.length ? <PrintButton label={pages.length > 1 ? `Print all ${pages.length} notices` : undefined} /> : null}
      </div>
      {kind === "yearend" && !yearEndNoticeOpen(today) ? (
        <div className="print:hidden"><Notice tone="warning">Year-end notices are meant for January and February. This one is dated today, {day(todayDate)}.</Notice></div>
      ) : null}
      {pages.length === 0 ? (
        <Notice>{kind === "contribution" ? `Nobody on loan has missed ${rules.contributionNoticeAfter} months of contributions.` : "Nobody owes the union anything at the moment."}</Notice>
      ) : null}

      {pages.map(({ member, months }, i) => {
        const loan = loans.find((l) => l.borrowerId === member.id);
        const pos = positions.get(member.id) ?? { principal: 0n, interestOwed: 0n };
        const owed = owedOf(pos);
        const savings = totals.get(member.id)?.savings ?? 0n;
        const guarantor = loan?.guarantor ? fullName(loan.guarantor) : null;
        const name = fullName(member);
        return (
          <article key={member.id} className={`mx-auto w-full max-w-[52rem] rounded-xl border border-line bg-white p-6 text-[15px] leading-relaxed sm:p-10 print:max-w-none print:border-0 print:p-0 print:text-[10.5pt] ${i ? "break-before-page" : ""}`}>
            <Letterhead title={title} subtitle={`${day(todayDate)} · ${member.memberNo}`} />
            <p className="font-semibold">{name}</p>
            {member.address ? <p className="text-sm text-muted">{member.address}</p> : null}
            {kind === "contribution" && guarantor ? <p className="mt-1 text-sm text-muted">Copy: {guarantor} (guarantor)</p> : null}

            <div className="mt-5 flex flex-col gap-3">
              <p>Dear {name},</p>
              {kind === "contribution" ? (
                <>
                  <p>
                    Our records show <strong>no monthly contribution from you for {list((months ?? []).map(monthLabel))}</strong>, while your loan
                    {loan ? <> of {formatNaira(loan.amountKobo)}</> : null} is running. Your loan balance today is <strong>{formatNaira(pos.principal)}</strong>
                    {pos.interestOwed > 0n ? <>, with interest of {formatNaira(pos.interestOwed)} unpaid</> : null}.
                  </p>
                  <p>
                    Paying interest alone is not enough. Members on loan must keep up their monthly contributions: they build your savings, which
                    secure your loan, and they count towards your share of the dividend at year end (only members who contribute for at least {rules.dividendMinMonths} months qualify).
                  </p>
                  <p>
                    Please pay the missed contributions{member.usualMonthlyKobo > 0n && months?.length ? <> ({months.length} × {formatNaira(member.usualMonthlyKobo)} = <strong>{formatNaira(member.usualMonthlyKobo * BigInt(months.length))}</strong>)</> : null}
                    {" "}into GT Bank account 0033550876 (Iyobor Progressive Union) <strong>by {day(payBy)}</strong>, and continue each month.
                  </p>
                  <p>
                    If contributions are still not paid, the union may treat your loan as at risk and take the further steps in your loan agreement
                    {guarantor ? <>, and your guarantor, who receives a copy of this notice, will be kept informed</> : null}.
                  </p>
                </>
              ) : (
                <>
                  <p>The {year.label} financial year ends on <strong>{day(year.endDate)}</strong>. Our records show that you still owe the union:</p>
                  <table className="w-full max-w-sm text-left">
                    <tbody>
                      <tr className="border-b border-line"><th className="py-1 font-normal text-muted">Loan balance</th><td className="py-1 text-right font-semibold tabular-nums">{formatNaira(pos.principal)}</td></tr>
                      <tr className="border-b border-line"><th className="py-1 font-normal text-muted">Interest unpaid</th><td className="py-1 text-right font-semibold tabular-nums">{formatNaira(pos.interestOwed > 0n ? pos.interestOwed : 0n)}</td></tr>
                      <tr><th className="py-1 font-semibold">Total owed today</th><td className="py-1 text-right font-bold tabular-nums">{formatNaira(owed)}</td></tr>
                    </tbody>
                  </table>
                  <p>
                    Please pay it into GT Bank account 0033550876 (Iyobor Progressive Union) <strong>by {day(year.endDate)}</strong>. Interest is charged
                    each month until the loan is cleared, so paying early costs you less.
                  </p>
                  <p>
                    Anything still owed at the close of the year will be <strong>deducted from your savings</strong> at settlement. Your savings this year are{" "}
                    {formatNaira(savings)}{savings >= owed
                      ? <>, so on today&apos;s figures about {formatNaira(savings - owed)} of your savings (before any dividend) would be paid to you.</>
                      : <>, which is less than you owe: the shortfall of {formatNaira(owed - savings)} would remain a debt to the union after settlement.</>}
                  </p>
                </>
              )}
              <p className="mt-1">Yours faithfully,</p>
              <div className="grid grid-cols-2 gap-10">
                <Sign who="Treasurer" name={signers.treasurer} />
                <Sign who={kind === "contribution" ? "Secretary" : "President"} name={kind === "contribution" ? signers.secretary : signers.president} />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
