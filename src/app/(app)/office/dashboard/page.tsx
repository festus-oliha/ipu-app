import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader, Stat } from "@/components/ui";
import { LOG_ROLES, OFFICER_ROLES, hasRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { ENTRY_LABELS, LIVE, coveredMonths } from "@/lib/ledger";
import { LOAN_STATUS_LABELS, PENDING_STATUSES, positionsThrough } from "@/lib/loans";
import { formatNaira } from "@/lib/money";
import { expectedBank, openingBank } from "@/lib/monthClose";
import { currentYear, formatDate, monthKey, monthLabel, todayLagos } from "@/lib/periods";
import { yearChangeReminders } from "@/lib/yearEnd";
import { notContributing, yearEndNoticeOpen } from "@/lib/notices";
import { settingsAt } from "@/lib/settings";

export const metadata: Metadata = { title: "Dashboard" };

const FAR = new Date(Date.UTC(2100, 0, 1));
const PERIOD_LABELS = { OPEN: "Open", READY: "Ready to sign", SIGNED: "Signed", LOCKED: "Closed" } as const;
const PERIOD_TONES = { OPEN: "bg-sand text-ink", READY: "bg-gold/15 text-gold-dark", SIGNED: "bg-gold/15 text-gold-dark", LOCKED: "bg-forest/10 text-forest" } as const;

const naira = (k: bigint) => formatNaira(k, { compact: true });

/** One page for officers: where the money is, and what needs doing. */
export default async function DashboardPage() {
  const user = await requireRole(...OFFICER_ROLES);
  const year = await currentYear();
  if (!year) return <p>No open financial year.</p>;
  const today = todayLagos();
  const thisMonth = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);

  const [periods, opening, flows, positions, members, covered, receipts, loansWaiting, exits, failed, investments, sms, defaulted, recent] = await Promise.all([
    db.period.findMany({ where: { yearId: year.id }, orderBy: { month: "asc" } }),
    openingBank(year),
    db.ledgerEntry.groupBy({ by: ["type"], where: { ...LIVE, period: { yearId: year.id } }, _sum: { amountKobo: true } }),
    positionsThrough(FAR),
    db.member.findMany({ where: { status: { not: "EXITED" } }, select: { id: true, phone: true, title: true, fullName: true, memberNo: true, usualMonthlyKobo: true } }),
    coveredMonths(year),
    db.receipt.count({ where: { status: "PENDING" } }),
    db.loan.groupBy({ by: ["status"], where: { status: { in: PENDING_STATUSES } }, _count: true, _sum: { amountKobo: true } }),
    db.exit.count({ where: { status: { in: ["REQUESTED", "APPROVED"] } } }),
    db.notification.count({ where: { status: "FAILED" } }),
    db.investment.findMany({ where: { status: { in: ["PROPOSED", "ACTIVE"] } } }),
    db.notification.aggregate({ where: { channel: "SMS", status: "SENT", sentAt: { gte: year.startDate } }, _sum: { costKobo: true }, _count: true }),
    db.loan.count({ where: { status: "DEFAULTED" } }),
    db.ledgerEntry.findMany({
      where: { ...LIVE, memberId: { not: null }, type: { in: ["CONTRIBUTION", "MEMBERSHIP_FEE", "INTEREST_PAID", "LOAN_REPAID"] } },
      include: { member: { select: { fullName: true, title: true } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);

  const latest = [...periods].reverse().find((p) => p.month <= thisMonth) ?? periods[0];
  const bank = opening !== null && latest ? await expectedBank(latest, opening) : null;
  const sum = (t: string) => flows.find((f) => f.type === t)?._sum.amountKobo ?? 0n;

  const memberIds = new Set(members.map((m) => m.id));
  let onLoan = 0n, interestOwed = 0n, borrowers = 0, inArrears = 0;
  for (const [id, p] of positions) {
    if (!memberIds.has(id)) continue;
    if (p.principal > 0n) { onLoan += p.principal; borrowers++; }
    if (p.interestOwed > 0n) { interestOwed += p.interestOwed; inArrears++; }
  }
  const invested = investments.filter((i) => i.status === "ACTIVE").reduce((t, i) => t + i.amountPlacedKobo, 0n);

  // Who has not paid for this month yet (a payment made ahead counts).
  const key = monthKey(latest?.month ?? thisMonth);
  // Members with no usual monthly amount (e.g. the Admin) are not expected to pay.
  const payers = members.filter((m) => m.usualMonthlyKobo > 0n);
  const unpaid = payers.filter((m) => !covered.get(m.id)?.has(key));
  const noPhone = members.filter((m) => !m.phone).length;

  // Months that have ended but are not closed yet.
  const endedOpen = periods.filter((p) => p.status !== "LOCKED" && new Date(Date.UTC(p.month.getUTCFullYear(), p.month.getUTCMonth() + 1, 1)).toISOString().slice(0, 10) <= today);

  const todo: { text: string; href: string }[] = [];
  if (receipts) todo.push({ text: `${receipts} uploaded receipt${receipts === 1 ? "" : "s"} to check`, href: "/office/receipts" });
  for (const l of loansWaiting) todo.push({ text: `${l._count} loan request${l._count === 1 ? "" : "s"}: ${LOAN_STATUS_LABELS[l.status].toLowerCase()} (${naira(l._sum.amountKobo ?? 0n)})`, href: "/office/loans" });
  for (const p of endedOpen) todo.push({ text: `${monthLabel(p.month)} has ended: ${p.status === "OPEN" ? "close the month" : "waiting for signatures"}`, href: `/office/sheet?month=${monthKey(p.month)}` });
  if (exits) todo.push({ text: `${exits} member${exits === 1 ? "" : "s"} leaving: exit to approve or pay`, href: "/office/exits" });
  if (defaulted) todo.push({ text: `${defaulted} defaulted loan${defaulted === 1 ? "" : "s"} to recover`, href: "/office/debtors" });
  const proposed = investments.filter((i) => i.status === "PROPOSED").length;
  if (proposed) todo.push({ text: `${proposed} investment${proposed === 1 ? "" : "s"} waiting for approval`, href: "/office/bank" });
  const notPaying = await notContributing(today);
  if (notPaying.length) todo.push({ text: `${notPaying.length} borrower${notPaying.length === 1 ? " has" : "s have"} paid no contribution for ${(await settingsAt()).contributionNoticeAfter} months or more: notice due`, href: "/office/debtors?show=contrib" });
  if (yearEndNoticeOpen(today) && borrowers + inArrears > 0) todo.push({ text: "Year end is near: print year-end notices for members who still owe", href: "/documents/notice/all?kind=yearend" });
  if (failed) todo.push({ text: `${failed} message${failed === 1 ? "" : "s"} failed to send`, href: "/office/messages?show=FAILED" });
  if (hasRole(user, "ADMIN")) todo.push(...(await yearChangeReminders(today)));
  if (noPhone && hasRole(user, "ADMIN", "SECRETARY")) todo.push({ text: `${noPhone} member${noPhone === 1 ? " has" : "s have"} no phone number, so cannot sign in or get SMS`, href: "/office/members" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={`Office · ${year.label}`} title="Dashboard">
        <span className="text-sm text-muted">As at {formatDate(new Date(`${today}T00:00:00Z`))}</span>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="GT Bank balance (app)" value={bank === null ? "–" : naira(bank)} note={bank === null ? "Opening balance not entered" : `To end of ${latest ? monthLabel(latest.month) : ""}`} />
        <Stat label="Out on loans" value={naira(onLoan)} note={`${borrowers} borrower${borrowers === 1 ? "" : "s"}`} />
        <Stat label="Interest unpaid" value={naira(interestOwed)} note={`${inArrears} member${inArrears === 1 ? "" : "s"} owing`} />
        <Stat label="Invested" value={naira(invested)} note="MMF, bills and deposits" />
        <Stat label="Savings this year" value={naira(sum("CONTRIBUTION") - sum("DEDUCTION"))} note={`${members.length} members`} />
        <Stat label="Interest this year" value={naira(sum("INTEREST_PAID"))} note={`Collected of ${naira(sum("INTEREST_CHARGED"))} charged`} />
        <Stat label="Membership fees" value={naira(sum("MEMBERSHIP_FEE"))} note={`SMS spend ${naira(sms._sum.costKobo ?? 0n)} (${sms._count} sent)`} />
        <Stat label={`Not paid ${latest ? monthLabel(latest.month).split(" ")[0] : ""}`} value={String(unpaid.length)} note={`of ${payers.length} who pay monthly`} />
      </div>

      <Card title="Needs attention">
        {todo.length === 0 ? (
          <p className="text-sm text-muted">Nothing waiting. Everything is up to date.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {todo.map((t, i) => (
              <li key={i}>
                <Link href={t.href} className="flex items-center justify-between gap-3 py-3 hover:text-forest">
                  <span>{t.text}</span>
                  <span aria-hidden className="text-gold-dark">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Months">
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {periods.map((p) => (
              <li key={p.id}>
                <Link href={`/office/sheet?month=${monthKey(p.month)}`} className={`flex flex-col rounded-lg px-3 py-2 text-sm ${PERIOD_TONES[p.status]} ${p.month > thisMonth ? "opacity-50" : ""}`}>
                  <span className="font-semibold">{monthLabel(p.month).split(" ")[0].slice(0, 3)}</span>
                  <span className="text-xs">{p.month > thisMonth ? "Not yet" : PERIOD_LABELS[p.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={`Not paid for ${latest ? monthLabel(latest.month) : "this month"}`}>
          {unpaid.length === 0 ? <p className="text-sm text-muted">Everyone has paid.</p> : (
            <ul className="flex flex-col gap-1 text-sm">
              {unpaid.slice(0, 12).map((m) => (
                <li key={m.id}>
                  <Link href={`/office/members/${m.id}`} className="hover:text-forest hover:underline">{[m.title, m.fullName].filter(Boolean).join(" ")}</Link>
                </li>
              ))}
              {unpaid.length > 12 ? <li className="text-muted">and {unpaid.length - 12} more (see the monthly sheet)</li> : null}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Latest payments recorded">
        {recent.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex justify-between gap-3 py-2">
                <span>{r.member ? [r.member.title, r.member.fullName].filter(Boolean).join(" ") : ""} <span className="text-muted">· {ENTRY_LABELS[r.type].toLowerCase()} · {formatDate(r.date)}</span></span>
                <span className="font-semibold tabular-nums">{formatNaira(r.amountKobo)}</span>
              </li>
            ))}
          </ul>
        )}
        {hasRole(user, ...LOG_ROLES) ? <p className="mt-3 text-sm"><Link href="/office/change-log" className="text-forest underline">See every change in the change log</Link></p> : null}
      </Card>
    </div>
  );
}
