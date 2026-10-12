import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, LinkButton, PageHeader, Stat } from "@/components/ui";
import { OFFICER_ROLES, PAYMENT_ROLES, hasRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { officerNames } from "@/lib/ledger";
import { formatNaira } from "@/lib/money";
import { expectedBank, openingBank } from "@/lib/monthClose";
import { currentYear, formatDate, monthKey, monthLabel, monthStart, todayLagos } from "@/lib/periods";
import { buildMonthSheet } from "@/lib/sheet";
import { closeMonth, reopenMonth, setOpeningBank, signMonth } from "./actions";
import { CloseForm, OpeningForm, ReopenForm, SignButton } from "./ClosePanel";
import { settingsAt } from "@/lib/settings";

export const metadata: Metadata = { title: "Monthly sheet" };

const money = (k: bigint) => (k === 0n ? "–" : formatNaira(k, { compact: true }));
const owed = (k: bigint) => (k === 0n ? "–" : k < 0n ? `${formatNaira(-k, { compact: true })} cr` : formatNaira(k, { compact: true }));
const STATUS: Record<string, string> = { OPEN: "Open", READY: "Ready for sign-off", SIGNED: "Signed", LOCKED: "Locked" };

export default async function SheetPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireRole(...OFFICER_ROLES);
  const { month } = await searchParams;
  // A month from another year (e.g. last February, still to be closed) opens that year's sheet.
  const asked = month ? monthStart(month) : null;
  const askedPeriod = asked ? await db.period.findFirst({ where: { month: asked }, include: { year: true } }) : null;
  const year = askedPeriod?.year ?? (await currentYear());
  if (!year) return <p>No open financial year. Run the seed or ask the Admin to open one.</p>;

  const periods = await db.period.findMany({ where: { yearId: year.id }, orderBy: { month: "asc" } });
  const otherYears = await db.financialYear.findMany({ where: { id: { not: year.id }, status: { not: "CLOSED" } }, orderBy: { startDate: "asc" } });
  const thisMonth = monthStart(todayLagos().slice(0, 7))!;
  const wanted = (month && monthStart(month)) || thisMonth;
  const period =
    periods.find((p) => p.month.getTime() === wanted?.getTime()) ??
    [...periods].reverse().find((p) => p.month.getTime() <= thisMonth.getTime()) ??
    periods[0];
  if (!period) notFound();

  const { rows, totals, bankIn, bankOut, activeMembers } = await buildMonthSheet(period);
  const canRecord = hasRole(user, ...PAYMENT_ROLES) && period.status === "OPEN";
  const today = todayLagos();
  const opening = await openingBank(year);
  const expected = opening === null ? null : await expectedBank(period, opening);
  const isFirst = period.id === periods[0]?.id;
  const earlierOpen = periods.find((p) => p.month < period.month && p.status === "OPEN");
  const laterClosed = periods.some((p) => p.month > period.month && p.status !== "OPEN");
  const names = await officerNames([period.readyById, period.presidentSignedById, period.secretarySignedById].filter((x): x is string => Boolean(x)));
  const signer = (id: string | null, at: Date | null) => (id ? `${names.get(id) ?? "Officer"}${at ? `, ${formatDate(at)}` : ""}` : "Not yet");
  const canSign =
    (period.status === "READY" || period.status === "SIGNED") &&
    period.presidentSignedById !== user.id &&
    period.secretarySignedById !== user.id &&
    ((hasRole(user, "PRESIDENT") && !period.presidentSignedById) || (hasRole(user, "SECRETARY") && !period.secretarySignedById));
  const signAs = hasRole(user, "PRESIDENT") && !period.presidentSignedById ? "President" : "Secretary";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={`Monthly sheet · ${year.label}`} title={monthLabel(period.month)}>
        {canRecord ? <LinkButton href="/office/payments/new">Record payment</LinkButton> : null}
      </PageHeader>

      {otherYears.length ? (
        <p className="-mt-3 text-sm">
          Also open:{" "}
          {otherYears.map((y) => (
            <Link key={y.id} href={`/office/sheet?month=${monthKey(y.startDate)}`} className="font-semibold text-forest underline">{y.label}</Link>
          ))}
        </p>
      ) : null}

      <nav aria-label="Months" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {periods.map((p) => {
          const active = p.id === period.id;
          return (
            <Link
              key={p.id}
              href={`/office/sheet?month=${monthKey(p.month)}`}
              aria-current={active ? "page" : undefined}
              className={`flex h-10 shrink-0 items-center rounded-lg px-3 text-sm font-semibold ${active ? "bg-forest text-ivory" : "border border-line bg-white text-ink hover:bg-sand"}`}
            >
              {monthLabel(p.month).slice(0, 3)}
            </Link>
          );
        })}
      </nav>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Contributions" value={formatNaira(totals.contribution, { compact: true })} note={`${totals.paid} of ${activeMembers} active members paid`} />
        <Stat label="Membership fees" value={formatNaira(totals.membershipFee, { compact: true })} />
        <Stat label="Money in" value={formatNaira(bankIn, { compact: true })} note={bankOut > 0n ? `Money out ${formatNaira(bankOut, { compact: true })}` : "All payments into the bank"} />
        <Stat label="Loans given" value={formatNaira(totals.loanGiven, { compact: true })} note={`Repaid ${formatNaira(totals.loanRepaid, { compact: true })}`} />
        <Stat label="Interest paid" value={formatNaira(totals.interestPaid, { compact: true })} note={`Loans out ${formatNaira(totals.loanBalance, { compact: true })}`} />
        <Stat label="Month status" value={STATUS[period.status]} note={expected !== null ? `App bank balance ${formatNaira(expected, { compact: true })}` : undefined} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[64rem] text-left text-sm">
          <caption className="sr-only">Payments for {monthLabel(period.month)}</caption>
          <thead className="bg-forest text-ivory">
            <tr>
              <th scope="col" className="px-3 py-3 font-semibold">No.</th>
              <th scope="col" className="px-3 py-3 font-semibold">Member</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Contribution</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Membership fee</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Loan given</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Interest paid</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Loan repaid</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Loan balance</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Interest due</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Savings to date</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Months paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.memberId} className={`border-t border-line ${r.contribution === 0n && !r.paidAhead ? "bg-ivory/60" : ""}`}>
                <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{r.memberNo}</td>
                <td className="px-3 py-2.5">
                  <Link href={`/office/members/${r.memberId}`} className="text-forest underline-offset-2 hover:underline">{r.name}</Link>
                </td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                  {r.paidAhead ? <span className="text-xs font-normal text-forest">Paid ahead</span> : money(r.contribution)}
                  {r.coversMonths > 1 ? <span className="block text-xs font-normal text-muted">covers {r.coversMonths} months</span> : null}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(r.membershipFee)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(r.loanGiven)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(r.interestPaid)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(r.loanRepaid)}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{money(r.loanBalance)}</td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${r.interestOwed > 0n ? "text-danger" : ""}`}>{owed(r.interestOwed)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(r.savingsToDate)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.monthsToDate}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-10 text-center text-muted">No members yet.</td></tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-forest bg-sand font-semibold">
              <th scope="row" colSpan={2} className="px-3 py-3">Total</th>
              <td className="px-3 py-3 text-right tabular-nums">{formatNaira(totals.contribution, { compact: true })}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatNaira(totals.membershipFee, { compact: true })}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatNaira(totals.loanGiven, { compact: true })}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatNaira(totals.interestPaid, { compact: true })}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatNaira(totals.loanRepaid, { compact: true })}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatNaira(totals.loanBalance, { compact: true })}</td>
              <td className="px-3 py-3 text-right tabular-nums">{owed(totals.interestOwed)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatNaira(totals.savingsToDate, { compact: true })}</td>
              <td className="px-3 py-3" />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted">
        Shaded rows have no contribution this month; &ldquo;Paid ahead&rdquo; means an earlier payment covers it. Loan balance is at the end of the month. Interest due is what must be paid by the
        15th of next month (it appears once the month is closed); &ldquo;cr&rdquo; is a credit from overpaid interest.
      </p>

      <Card title="Month close and sign-off">
        <dl className="mb-5 grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">Closed by Treasurer</dt><dd className="font-semibold">{signer(period.readyById, null)}</dd></div>
          <div><dt className="text-muted">Bank statement</dt><dd className="font-semibold">{period.bankStatementKobo !== null ? formatNaira(period.bankStatementKobo) : "–"}</dd></div>
          <div><dt className="text-muted">President</dt><dd className="font-semibold">{signer(period.presidentSignedById, period.presidentSignedAt)}</dd></div>
          <div><dt className="text-muted">Secretary</dt><dd className="font-semibold">{signer(period.secretarySignedById, period.secretarySignedAt)}</dd></div>
        </dl>
        <div className="flex flex-col gap-6">
          {isFirst && period.status === "OPEN" && hasRole(user, "ADMIN", "TREASURER") ? (
            <div>
              <p className="mb-2 text-sm">
                Opening bank balance: <span className="font-semibold">{opening === null ? "not entered yet" : formatNaira(opening)}</span>
              </p>
              <OpeningForm action={setOpeningBank.bind(null, year.id)} />
            </div>
          ) : null}
          {period.status === "OPEN" ? (
            hasRole(user, "TREASURER") ? (
              earlierOpen ? (
                <p className="text-sm text-muted">Close {monthLabel(earlierOpen.month)} first. Months are closed in order.</p>
              ) : today < monthKey(new Date(Date.UTC(period.month.getUTCFullYear(), period.month.getUTCMonth() + 1, 1))) + "-01" ? (
                <p className="text-sm text-muted">This month can be closed once it has ended and the bank statement is in.</p>
              ) : opening === null ? (
                <p className="text-sm text-muted">Enter the opening bank balance (on the March sheet) before closing.</p>
              ) : (
                <CloseForm action={closeMonth.bind(null, period.id)} expected={formatNaira(expected!)} interestPer1000={String((await settingsAt(period.month)).interestPer1000)} />
              )
            ) : (
              <p className="text-sm text-muted">The Treasurer closes the month once all payments are in and the bank statement matches.</p>
            )
          ) : null}
          {canSign ? <SignButton action={signMonth.bind(null, period.id)} label={`Sign as ${signAs}`} /> : null}
          {period.status === "LOCKED" ? <p className="text-sm text-forest">This month is signed by the President and the Secretary and is locked.</p> : null}
          {period.status !== "OPEN" && !laterClosed && hasRole(user, "ADMIN") ? (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-danger">Reopen this month</summary>
              <div className="mt-3">
                <p className="mb-3 text-sm text-muted">Reopening reverses this month&apos;s interest charges and clears the signatures. Use it only to fix a mistake.</p>
                <ReopenForm action={reopenMonth.bind(null, period.id)} />
              </div>
            </details>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
