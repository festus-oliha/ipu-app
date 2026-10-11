import type { Metadata } from "next";
import { ActionForm } from "@/components/ActionForm";
import { ReverseForm } from "@/components/ReverseForm";
import { Card, PageHeader, Stat } from "@/components/ui";
import { reverseEntry } from "@/app/(app)/office/payments/actions";
import { OFFICER_ROLES, hasRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { officerNames } from "@/lib/ledger";
import { formatNaira } from "@/lib/money";
import { expectedBank, openingBank } from "@/lib/monthClose";
import { currentYear, formatDate, todayLagos } from "@/lib/periods";
import { decideInvestment, placeInvestment, proposeInvestment, recordIncomeOrExpense, returnInvestment } from "./actions";

export const metadata: Metadata = { title: "Bank and investments" };

const KINDS = ["Money market fund (MMF)", "Treasury bill", "Fixed deposit", "Other"].map((k) => ({ value: k, label: k }));
const STATUS = { PROPOSED: "Waiting for President", ACTIVE: "Money placed", MATURED: "Returned", CANCELLED: "Declined" } as const;

export default async function BankPage() {
  const user = await requireRole(...OFFICER_ROLES);
  const year = await currentYear();
  if (!year) return <p>No open financial year.</p>;
  const today = todayLagos();
  const treasurer = hasRole(user, "TREASURER");

  const latest = await db.period.findFirst({ where: { yearId: year.id, month: { lte: new Date(`${today.slice(0, 7)}-01T00:00:00Z`) } }, orderBy: { month: "desc" } });
  const opening = await openingBank(year);
  const balance = opening !== null && latest ? await expectedBank(latest, opening) : null;

  const [investments, flows] = await Promise.all([
    db.investment.findMany({ orderBy: { createdAt: "desc" } }),
    db.ledgerEntry.findMany({
      where: { type: { in: ["OTHER_INCOME", "EXPENSE"] }, period: { yearId: year.id } },
      include: { reversedBy: true, period: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const active = investments.filter((i) => i.status === "ACTIVE");
  const returned = investments.filter((i) => i.status === "MATURED" && i.returnedOn && i.returnedOn >= year.startDate);
  const profit = returned.reduce((t, i) => t + (i.amountReturnedKobo ?? 0n) - i.amountPlacedKobo, 0n);
  const live = flows.filter((f) => !f.reversedBy);
  const income = live.filter((f) => f.type === "OTHER_INCOME").reduce((t, f) => t + f.amountKobo, 0n);
  const expenses = live.filter((f) => f.type === "EXPENSE").reduce((t, f) => t + f.amountKobo, 0n);
  const names = await officerNames(flows.map((f) => f.enteredById));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={`Office · ${year.label}`} title="Bank and investments" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="GT Bank balance (app)" value={balance === null ? "–" : formatNaira(balance, { compact: true })} note={balance === null ? "Opening balance not entered" : "Opening + money in − money out"} />
        <Stat label="Invested now" value={formatNaira(active.reduce((t, i) => t + i.amountPlacedKobo, 0n), { compact: true })} note={`${active.length} active`} />
        <Stat label="Investment profit" value={formatNaira(profit, { compact: true })} note="Returned this year" />
        <Stat label="Other income − expenses" value={formatNaira(income - expenses, { compact: true })} note={`In ${formatNaira(income, { compact: true })} · Out ${formatNaira(expenses, { compact: true })}`} />
      </div>

      <Card title="Investments">
        {investments.length === 0 ? <p className="mb-4 text-sm text-muted">No investments recorded yet.</p> : (
          <ul className="mb-6 flex flex-col divide-y divide-line">
            {investments.map((i) => {
              const gain = i.amountReturnedKobo !== null ? i.amountReturnedKobo - i.amountPlacedKobo : null;
              return (
                <li key={i.id} className="flex flex-col gap-3 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{i.kind} · {i.institution}</p>
                      <p className="text-sm text-muted">
                        {formatNaira(i.amountPlacedKobo)}{i.rateBps ? ` at ${(i.rateBps / 100).toFixed(2)}% a year` : ""} · placed {formatDate(i.placedOn)}
                        {i.maturityOn ? ` · matures ${formatDate(i.maturityOn)}` : ""}
                        {gain !== null ? ` · returned ${formatNaira(i.amountReturnedKobo!)} (profit ${formatNaira(gain)})` : ""}
                      </p>
                      {i.note ? <p className="text-sm text-muted">{i.note}</p> : null}
                    </div>
                    <span className="text-sm font-semibold text-forest">{i.status === "PROPOSED" && i.presidentApprovedById ? "Approved, to be placed" : STATUS[i.status]}</span>
                  </div>
                  {i.status === "PROPOSED" && !i.presidentApprovedById && hasRole(user, "PRESIDENT") && i.treasurerApprovedById !== user.id ? (
                    <ActionForm action={decideInvestment.bind(null, i.id)} buttons={[{ name: "decision", value: "approve", label: "Approve investment", tone: "primary" }, { name: "decision", value: "decline", label: "Decline", tone: "danger" }]} />
                  ) : null}
                  {i.status === "PROPOSED" && i.presidentApprovedById && treasurer ? (
                    <ActionForm action={placeInvestment.bind(null, i.id)} submit="Record money placed" fields={[
                      { name: "date", label: "Date it left GT Bank", type: "date", defaultValue: today, max: today },
                      { name: "bankRef", label: "Bank reference" },
                    ]} />
                  ) : null}
                  {i.status === "ACTIVE" && treasurer ? (
                    <ActionForm action={returnInvestment.bind(null, i.id)} submit="Record money returned" fields={[
                      { name: "amount", label: "Amount returned to GT Bank (₦)", type: "money", hint: "Principal plus profit, after charges" },
                      { name: "date", label: "Date received", type: "date", defaultValue: today, max: today },
                      { name: "bankRef", label: "Bank reference" },
                    ]} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {treasurer ? (
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-forest">Propose a new investment</summary>
            <div className="mt-3">
              <ActionForm action={proposeInvestment} submit="Send to President for approval" fields={[
                { name: "kind", label: "Kind", type: "select", options: KINDS },
                { name: "institution", label: "Bank or fund manager", placeholder: "e.g. Stanbic IBTC" },
                { name: "amount", label: "Amount (₦)", type: "money" },
                { name: "rate", label: "Yearly rate (%)", placeholder: "e.g. 18.5" },
                { name: "placedOn", label: "Planned date", type: "date", defaultValue: today },
                { name: "maturityOn", label: "Maturity date (if any)", type: "date" },
                { name: "note", label: "Note", wide: true },
              ]} />
            </div>
          </details>
        ) : null}
      </Card>

      <Card title="Other income and expenses">
        {treasurer ? (
          <div className="mb-6">
            <ActionForm action={recordIncomeOrExpense} submit="Record" fields={[
              { name: "kind", label: "Money in or out", type: "select", options: [{ value: "EXPENSE", label: "Money out: expense (bank charges, SMS…)" }, { value: "OTHER_INCOME", label: "Money in: other income" }] },
              { name: "amount", label: "Amount (₦)", type: "money" },
              { name: "date", label: "Date on the bank statement", type: "date", defaultValue: today, max: today },
              { name: "bankRef", label: "Bank reference" },
              { name: "note", label: "What it was for", wide: true, placeholder: "e.g. SMS bundle, 2,000 units" },
            ]} />
          </div>
        ) : null}
        {flows.length === 0 ? <p className="text-sm text-muted">Nothing recorded this year.</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {flows.map((f) => (
              <li key={f.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${f.reversedBy ? "text-muted line-through" : ""}`}>{f.note}</p>
                  <p className="text-xs text-muted">{formatDate(f.date)}{f.bankRef ? ` · Ref ${f.bankRef}` : ""} · by {names.get(f.enteredById)}</p>
                  {f.reversedBy ? <p className="text-xs text-danger">Reversed: {f.reversedBy.note}</p> : null}
                  {!f.reversedBy && f.period.status === "OPEN" && hasRole(user, "ADMIN", "TREASURER") ? <ReverseForm action={reverseEntry.bind(null, f.id)} /> : null}
                </div>
                <p className={`shrink-0 font-semibold tabular-nums ${f.type === "EXPENSE" ? "text-danger" : "text-forest"} ${f.reversedBy ? "line-through opacity-60" : ""}`}>
                  {f.type === "EXPENSE" ? "−" : "+"}{formatNaira(f.amountKobo, { compact: true })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
