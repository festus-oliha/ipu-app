import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Card, Notice, PageHeader, Stat } from "@/components/ui";
import { OFFICER_ROLES, hasRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatNaira } from "@/lib/money";
import { formatDate, monthKey, monthLabel, todayLagos } from "@/lib/periods";
import { yearEndPreview, yearToSettle } from "@/lib/yearEnd";
import { closeYear, openNextYear, recordSettlementPayout, setDebtorPlan, setDividendRate } from "./actions";

export const metadata: Metadata = { title: "Year end" };

const m = (k: bigint) => (k === 0n ? "–" : formatNaira(k, { compact: true }));

export default async function YearEndPage() {
  const user = await requireRole(...OFFICER_ROLES);
  const admin = hasRole(user, "ADMIN");
  const treasurer = hasRole(user, "TREASURER");
  const today = todayLagos();
  const year = await yearToSettle();
  const newest = await db.financialYear.findFirst({ orderBy: { startDate: "desc" } });
  const canOpenNext = newest && newest.status !== "CLOSED" && today >= `${monthKey(newest.endDate)}-01`;
  const lastClosed = await db.financialYear.findFirst({
    where: { status: "CLOSED" },
    orderBy: { startDate: "desc" },
    include: { settlements: { include: { member: true }, orderBy: { member: { memberNo: "asc" } } } },
  });

  const preview = year ? await yearEndPreview(year) : null;
  const openMonths = year?.periods.filter((p) => p.status === "OPEN") ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Office" title="Year end" />

      {canOpenNext && admin ? (
        <Card title={`Open ${newest.endDate.getUTCFullYear()}–${newest.endDate.getUTCFullYear() + 1}`}>
          <p className="mb-3 text-sm">Open next year&apos;s months now so payments made from 1 March can be recorded while this year is being closed.</p>
          <ActionForm action={openNextYear} submit="Open next financial year" />
        </Card>
      ) : null}

      {year && preview ? (
        <>
          <Card title={`Settle ${year.label}`}>
            <ol className="mb-5 flex flex-col gap-2 text-sm">
              <li>
                <span className="font-semibold">1. Close every month to February.</span>{" "}
                {openMonths.length ? (
                  <span className="text-danger">Still open: {openMonths.map((p) => <Link key={p.id} href={`/office/sheet?month=${monthKey(p.month)}`} className="underline">{monthLabel(p.month).slice(0, 3)}</Link>).reduce<React.ReactNode[]>((a, x, i) => (i ? [...a, ", ", x] : [x]), [])}.</span>
                ) : <span className="text-forest">Done.</span>} February&apos;s interest is charged when February is closed.
              </li>
              <li><span className="font-semibold">2. Set the dividend rate</span> agreed by the union. Members who paid in 4 or more months qualify.</li>
              <li><span className="font-semibold">3. Check the figures below,</span> then close the year. Loans and interest owed are taken from each member&apos;s savings; members who owe more than their savings become debtors.</li>
            </ol>
            {admin ? (
              <ActionForm action={setDividendRate.bind(null, year.id)} submit="Save dividend rate" fields={[
                { name: "rate", label: "Dividend rate (%)", defaultValue: year.dividendRateBps !== null ? (year.dividendRateBps / 100).toString() : "", placeholder: "e.g. 4.2" },
              ]} />
            ) : <p className="text-sm">Dividend rate: <span className="font-semibold">{year.dividendRateBps !== null ? `${(year.dividendRateBps / 100).toFixed(2)}%` : "not set"}</span></p>}
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Union earned" value={formatNaira(preview.earned, { compact: true })} note="Interest + investment profit + other income − expenses" />
            <Stat label="Dividend to pay" value={formatNaira(preview.totals.dividend, { compact: true })} note={preview.earned - preview.totals.dividend >= 0n ? `Leaves ${formatNaira(preview.earned - preview.totals.dividend, { compact: true })}` : `${formatNaira(preview.totals.dividend - preview.earned, { compact: true })} more than earned`} />
            <Stat label="Total payout" value={formatNaira(preview.totals.payout, { compact: true })} note={`Taken for loans ${formatNaira(preview.totals.deducted, { compact: true })}`} />
            <Stat label="Debtors" value={String(preview.totals.debtors)} note={preview.totals.shortfall ? `Still owed ${formatNaira(preview.totals.shortfall, { compact: true })}` : "None"} />
          </div>
          <p className="-mt-3 text-xs text-muted">
            Earned: interest {formatNaira(preview.income.interest, { compact: true })}, investments {formatNaira(preview.income.investmentProfit, { compact: true })}, other {formatNaira(preview.income.otherIncome, { compact: true })}, expenses {formatNaira(preview.income.expenses, { compact: true })}. Membership fees ({formatNaira(preview.income.membershipFees, { compact: true })}) pay for running costs and are not shared.
          </p>
          {preview.earned < preview.totals.dividend ? <Notice tone="warning">At this rate the dividend is more than the union earned this year. Check the rate before closing.</Notice> : null}

          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <caption className="sr-only">Year-end figures per member</caption>
              <thead className="bg-forest text-ivory">
                <tr>
                  {["No.", "Member", "Contributions", "Months", "Dividend", "Credit back", "Interest owed", "Loan", "Payout", "Still owes"].map((h, i) => (
                    <th key={h} scope="col" className={`px-3 py-3 font-semibold ${i > 1 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.memberId} className={`border-t border-line ${r.shortfall ? "bg-danger/5" : ""}`}>
                    <td className="px-3 py-2.5 font-mono text-xs">{r.memberNo}</td>
                    <td className="px-3 py-2.5">{r.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{m(r.contributions)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${r.qualifies ? "" : "text-danger"}`}>{r.months}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{m(r.dividend)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{m(r.credit)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.interestDeducted ? `−${m(r.interestDeducted)}` : "–"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.loanDeducted ? `−${m(r.loanDeducted)}` : "–"}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{m(r.payout)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-danger">{m(r.shortfall)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-forest bg-sand font-semibold">
                  <th scope="row" colSpan={2} className="px-3 py-3">Total ({preview.rows.length} members)</th>
                  <td className="px-3 py-3 text-right tabular-nums">{m(preview.totals.contributions)}</td>
                  <td />
                  <td className="px-3 py-3 text-right tabular-nums">{m(preview.totals.dividend)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{m(preview.totals.credit)}</td>
                  <td colSpan={2} className="px-3 py-3 text-right tabular-nums">{preview.totals.deducted ? `−${m(preview.totals.deducted)}` : "–"}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{m(preview.totals.payout)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{m(preview.totals.shortfall)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="-mt-3 text-xs text-muted">Months in red are below 4: no dividend. Members who left during the year were paid at exit and are not listed.</p>

          {admin ? (
            <Card title={`Close ${year.label}`}>
              <ActionForm action={closeYear.bind(null, year.id)} submit="Close the year" tone="danger"
                intro={<p className="text-sm">This saves every member&apos;s settlement, takes loans and interest from savings, and sends each member an SMS. It cannot be undone.</p>}
                fields={[{ name: "confirm", label: "Type CLOSE to confirm" }]} />
            </Card>
          ) : null}
        </>
      ) : <Card><p className="text-sm text-muted">No year is waiting to be closed.</p></Card>}

      {lastClosed ? (
        <Card title={`Payouts for ${lastClosed.label}`}>
          <p className="mb-4 text-sm text-muted">Closed {lastClosed.closedAt ? formatDate(lastClosed.closedAt) : ""}. The Treasurer records each transfer as it is made.</p>
          <ul className="flex flex-col divide-y divide-line">
            {lastClosed.settlements.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                  <span><span className="font-semibold">{s.member.fullName}</span> · {s.member.memberNo}</span>
                  {s.result === "DEBTOR" ? (
                    <span className="font-semibold text-danger">Owes {formatNaira(-s.payoutKobo)} · {s.debtorPlan === "PAY_UP" ? `pay up by ${s.debtorDueOn ? formatDate(s.debtorDueOn) : "?"}` : "carried over"}</span>
                  ) : s.paidOn ? (
                    <span className="text-forest">{formatNaira(s.payoutKobo)} paid {formatDate(s.paidOn)}{s.bankRef ? ` · Ref ${s.bankRef}` : ""}</span>
                  ) : <span className="font-semibold">{formatNaira(s.payoutKobo)} to pay</span>}
                </div>
                {s.result === "PAID" && !s.paidOn && s.payoutKobo > 0n && treasurer && s.member.userId !== user.id ? (
                  <ActionForm action={recordSettlementPayout.bind(null, s.id)} submit="Record payout sent" fields={[
                    { name: "date", label: "Date of transfer", type: "date", defaultValue: today, max: today },
                    { name: "bankRef", label: "Bank reference" },
                  ]} />
                ) : null}
                {s.result === "DEBTOR" && admin ? (
                  <ActionForm action={setDebtorPlan.bind(null, s.id)} submit="Save plan" fields={[
                    { name: "plan", label: "Plan", type: "select", defaultValue: s.debtorPlan ?? "CARRY_OVER", options: [{ value: "CARRY_OVER", label: "Carry the debt into the new year" }, { value: "PAY_UP", label: "Pay up by a date" }] },
                    { name: "due", label: "Pay by (if paying up)", type: "date", defaultValue: s.debtorDueOn?.toISOString().slice(0, 10) },
                  ]} />
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
