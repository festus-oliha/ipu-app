import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkButton, PageHeader, Stat } from "@/components/ui";
import { OFFICER_ROLES, PAYMENT_ROLES, hasRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatNaira } from "@/lib/money";
import { currentYear, monthKey, monthLabel, monthStart, todayLagos } from "@/lib/periods";
import { buildMonthSheet } from "@/lib/sheet";

export const metadata: Metadata = { title: "Monthly sheet" };

const money = (k: bigint) => (k === 0n ? "–" : formatNaira(k, { compact: true }));
const STATUS: Record<string, string> = { OPEN: "Open", READY: "Ready for sign-off", SIGNED: "Signed", LOCKED: "Locked" };

export default async function SheetPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireRole(...OFFICER_ROLES);
  const year = await currentYear();
  if (!year) return <p>No open financial year. Run the seed or ask the Admin to open one.</p>;

  const periods = await db.period.findMany({ where: { yearId: year.id }, orderBy: { month: "asc" } });
  const { month } = await searchParams;
  const thisMonth = monthStart(todayLagos().slice(0, 7))!;
  const wanted = (month && monthStart(month)) || thisMonth;
  const period =
    periods.find((p) => p.month.getTime() === wanted?.getTime()) ??
    [...periods].reverse().find((p) => p.month.getTime() <= thisMonth.getTime()) ??
    periods[0];
  if (!period) notFound();

  const { rows, totals, bankIn, bankOut, activeMembers } = await buildMonthSheet(period);
  const canRecord = hasRole(user, ...PAYMENT_ROLES) && period.status === "OPEN";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={`Monthly sheet · ${year.label}`} title={monthLabel(period.month)}>
        {canRecord ? <LinkButton href="/office/payments/new">Record payment</LinkButton> : null}
      </PageHeader>

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

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Contributions" value={formatNaira(totals.contribution, { compact: true })} note={`${totals.paid} of ${activeMembers} active members paid`} />
        <Stat label="Membership fees" value={formatNaira(totals.membershipFee, { compact: true })} />
        <Stat label="Money in" value={formatNaira(bankIn, { compact: true })} note={bankOut > 0n ? `Money out ${formatNaira(bankOut, { compact: true })}` : "All payments into the bank"} />
        <Stat label="Month status" value={STATUS[period.status]} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <caption className="sr-only">Payments for {monthLabel(period.month)}</caption>
          <thead className="bg-forest text-ivory">
            <tr>
              <th scope="col" className="px-3 py-3 font-semibold">No.</th>
              <th scope="col" className="px-3 py-3 font-semibold">Member</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Contribution</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Membership fee</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Savings to date</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Months paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.memberId} className={`border-t border-line ${r.contribution === 0n ? "bg-ivory/60" : ""}`}>
                <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{r.memberNo}</td>
                <td className="px-3 py-2.5">
                  <Link href={`/office/members/${r.memberId}`} className="text-forest underline-offset-2 hover:underline">{r.name}</Link>
                </td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{money(r.contribution)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(r.membershipFee)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(r.savingsToDate)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.monthsToDate}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-muted">No members yet.</td></tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-forest bg-sand font-semibold">
              <th scope="row" colSpan={2} className="px-3 py-3">Total</th>
              <td className="px-3 py-3 text-right tabular-nums">{formatNaira(totals.contribution, { compact: true })}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatNaira(totals.membershipFee, { compact: true })}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatNaira(totals.savingsToDate, { compact: true })}</td>
              <td className="px-3 py-3" />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted">
        Shaded rows have no contribution this month. Loans, interest and the bank balance join this sheet in phase 3.
      </p>
    </div>
  );
}
