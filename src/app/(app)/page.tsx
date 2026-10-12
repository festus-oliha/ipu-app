import { PaymentHistory } from "@/components/PaymentHistory";
import { Card, LinkButton, Notice, Stat } from "@/components/ui";
import { OFFICER_ROLES, PAYMENT_ROLES, hasRole, requireUser } from "@/lib/auth";
import { memberYearTotals } from "@/lib/ledger";
import Link from "next/link";
import { db } from "@/lib/db";
import { LOAN_STATUS_LABELS, OPEN_LOAN_STATUSES, memberPosition } from "@/lib/loans";
import { formatNaira } from "@/lib/money";
import { MONTH_NAMES, currentYear, formatDate, todayLagos } from "@/lib/periods";
import { yearChangeReminders } from "@/lib/yearEnd";
import { displayPhone } from "@/lib/phone";
import { loanMonthsText } from "@/lib/rules";
import { settingsAt } from "@/lib/settings";


const RECEIPT_STATUS = { PENDING: "Waiting to be checked", CONFIRMED: "Confirmed", REJECTED: "Not accepted" } as const;

export default async function HomePage({ searchParams }: { searchParams: Promise<{ uploaded?: string }> }) {
  const { uploaded } = await searchParams;
  const user = await requireUser();
  const year = await currentYear();
  const rules = await settingsAt();
  const DIVIDEND_MIN_MONTHS = rules.dividendMinMonths;
  const totals = user.member && year ? await memberYearTotals(user.member.id, year) : null;
  const memberId = user.member?.id;
  const [position, myLoans, guaranteeing, receipts] = memberId
    ? await Promise.all([
        memberPosition(memberId),
        db.loan.findMany({ where: { borrowerId: memberId, status: { in: [...OPEN_LOAN_STATUSES, "REJECTED"] } }, orderBy: { createdAt: "desc" }, take: 3 }),
        db.loan.findMany({ where: { guarantorId: memberId, status: { in: OPEN_LOAN_STATUSES } }, include: { borrower: true }, orderBy: { createdAt: "desc" } }),
        db.receipt.findMany({ where: { memberId }, orderBy: { createdAt: "desc" }, take: 5 }),
      ])
    : [null, [], [], []];
  const exited = memberId ? (await db.member.findUnique({ where: { id: memberId }, select: { status: true } }))?.status === "EXITED" : false;
  const today = todayLagos();
  const yearTasks = hasRole(user, "ADMIN") ? await yearChangeReminders(today) : [];
  const [, mm, dd] = today.split("-").map(Number);
  const nextMonth = MONTH_NAMES[mm % 12];
  const dueMonth = dd <= 15 ? MONTH_NAMES[mm - 1] : nextMonth;
  const yearEndWarning = mm === 12 || mm === 1 || (mm === 2 && dd <= 15);
  const loanWindowOpen = rules.loanMonths.includes(mm);
  const hasPending = myLoans.some((l) => l.status !== "DISBURSED" && l.status !== "REJECTED");
  const owes = position ? position.principal > 0n || position.interestOwed > 0n : false;
  const loanStat = !position || (position.principal <= 0n && position.interestOwed === 0n)
    ? { value: "No loan", note: hasPending ? "Request in progress" : "Nothing owed" }
    : {
        value: formatNaira(position.principal, { compact: true }),
        note: position.interestOwed > 0n
          ? `Interest ${formatNaira(position.interestOwed, { compact: true })} due by 15 ${dueMonth}`
          : position.interestOwed < 0n
            ? `Interest credit ${formatNaira(-position.interestOwed, { compact: true })}`
            : "No interest owed now",
      };
  const name = user.member ? [user.member.title, user.member.fullName].filter(Boolean).join(" ") : displayPhone(user.phone);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm tracking-[0.2em] text-gold-dark uppercase">Welcome</p>
        <h1 className="mt-1 font-display text-3xl text-ink">{name}</h1>
        {user.member ? <p className="mt-1 text-sm text-muted">{user.member.memberNo}</p> : null}
      </div>

      {yearTasks.map((t) => (
        <Notice key={t.text} tone="warning">
          {t.text} <Link href={t.href} className="font-semibold text-forest underline">Go to Year end</Link>
        </Notice>
      ))}

      {totals && year ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={`My savings ${year.label}`} value={formatNaira(totals.savings, { compact: true })} note={totals.deducted ? `Paid in ${totals.monthsContributed} of 12 months · ${formatNaira(totals.deducted, { compact: true })} used for a debt` : `Paid in ${totals.monthsContributed} of 12 months`} />
            <Stat label="My loan balance" value={loanStat.value} note={loanStat.note} />
            <Stat
              label="Dividend"
              value={totals.monthsContributed >= DIVIDEND_MIN_MONTHS ? "Qualified" : `${DIVIDEND_MIN_MONTHS - totals.monthsContributed} more months`}
              note={`Members who pay in ${DIVIDEND_MIN_MONTHS}+ months share the dividend`}
            />
          </div>
          {uploaded ? <Notice tone="success">Receipt sent. The Treasurer will check it against the bank statement; you get an SMS once it is confirmed.</Notice> : null}

          {exited ? <Notice>You have left the union. Your records stay here for you to see.</Notice> : null}

          {exited ? null : <Card title="Pay and upload your receipt">
            <p className="mb-4 text-sm">Pay into <span className="font-semibold">GT Bank, account 0033550876</span> (Iyobor Progressive Union), then send a photo of the receipt.</p>
            <LinkButton href="/receipts/new">Upload receipt</LinkButton>
            {receipts.length ? (
              <ul className="mt-4 flex flex-col divide-y divide-line border-t border-line">
                {receipts.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <a href={`/files/receipts/${r.id}`} target="_blank" rel="noreferrer" className="font-semibold text-forest underline-offset-2 hover:underline">
                      {formatNaira(r.amountKobo, { compact: true })} · {formatDate(r.paidOn)}
                    </a>
                    <span className={r.status === "REJECTED" ? "text-danger" : "text-muted"}>
                      {RECEIPT_STATUS[r.status]}{r.rejectReason ? `: ${r.rejectReason}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>}

          {yearEndWarning && owes ? (
            <Notice tone="warning">
              Year end is near. Any loan and interest still owed will be taken from your contributions at year end, unless you pay it off
              or agree to carry it into next year. New loans are not given in January and February.
            </Notice>
          ) : null}

          {guaranteeing.some((l) => l.status === "REQUESTED") ? (
            <Notice tone="warning">
              {guaranteeing.filter((l) => l.status === "REQUESTED").map((l) => (
                <p key={l.id}>
                  {[l.borrower.title, l.borrower.fullName].filter(Boolean).join(" ")} has asked you to guarantee a loan of {formatNaira(l.amountKobo)}.{" "}
                  <Link href={`/loans/${l.id}`} className="font-semibold text-forest underline">Read and answer</Link>
                </p>
              ))}
            </Notice>
          ) : null}

          <Card title="My loan">
            {myLoans.length > 0 ? (
              <ul className="mb-4 flex flex-col divide-y divide-line">
                {myLoans.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <Link href={`/loans/${l.id}`} className="font-semibold text-forest underline-offset-2 hover:underline">{formatNaira(l.amountKobo)} · {l.purpose}</Link>
                    <span className="text-muted">{LOAN_STATUS_LABELS[l.status]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-sm text-muted">
                You can borrow up to your usual monthly contribution × {String(rules.loanLimitMonths)}. Interest is ₦{String(rules.interestPer1000)} per ₦1,000 a month, due by the 15th of the next month.
              </p>
            )}
            {hasPending || exited ? null : loanWindowOpen ? (
              <LinkButton href="/loans/new">Request a loan</LinkButton>
            ) : (
              <p className="text-sm text-muted">Loans are given from {loanMonthsText(rules)}.</p>
            )}
          </Card>

          {guaranteeing.length > 0 ? (
            <Card title="Loans I guarantee">
              <ul className="flex flex-col divide-y divide-line">
                {guaranteeing.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <Link href={`/loans/${l.id}`} className="font-semibold text-forest underline-offset-2 hover:underline">
                      {[l.borrower.title, l.borrower.fullName].filter(Boolean).join(" ")} · {formatNaira(l.amountKobo)}
                    </Link>
                    <span className="text-muted">{LOAN_STATUS_LABELS[l.status]}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">If a borrower defaults, their own contributions are used first, then the guarantor&apos;s.</p>
            </Card>
          ) : null}

          <Card title="My payments this year">
            <PaymentHistory memberId={user.member!.id} />
            <div className="mt-4"><LinkButton href={`/statement/${user.member!.id}`} variant="secondary">My statement (print or PDF)</LinkButton></div>
          </Card>
          <p className="text-center text-sm">
            <Link href="/exit" className="text-muted underline underline-offset-2">{exited ? "My exit" : "Leave the union"}</Link>
          </p>

        </>
      ) : null}

      {hasRole(user, ...OFFICER_ROLES) ? (
        <Card title="Office">
          <div className="flex flex-wrap gap-2">
            {hasRole(user, ...PAYMENT_ROLES) ? <LinkButton href="/office/payments/new">Record payment</LinkButton> : null}
            <LinkButton href="/office/dashboard" variant="secondary">Dashboard</LinkButton>
            <LinkButton href="/office/sheet" variant="secondary">Monthly sheet</LinkButton>
            <LinkButton href="/office/loans" variant="secondary">Loans</LinkButton>
            <LinkButton href="/office/debtors" variant="secondary">Debtors</LinkButton>
            <LinkButton href="/office" variant="secondary">More…</LinkButton>
            <LinkButton href="/office/members" variant="secondary">Members</LinkButton>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
