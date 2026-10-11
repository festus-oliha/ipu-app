import type { Metadata } from "next";
import { Letterhead } from "@/components/Letterhead";
import { PrintButton } from "@/components/PrintButton";
import { OFFICER_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { ENTRY_LABELS, LIVE } from "@/lib/ledger";
import { formatNaira } from "@/lib/money";
import { openingBank } from "@/lib/monthClose";
import { currentYear } from "@/lib/periods";
import type { EntryType } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Income and bank summary" };

const IN: EntryType[] = ["CONTRIBUTION", "MEMBERSHIP_FEE", "INTEREST_PAID", "LOAN_REPAID", "OTHER_INCOME", "INVESTMENT_RETURNED"];
const OUT: EntryType[] = ["LOAN_GIVEN", "INVESTMENT_PLACED", "EXPENSE", "PAYOUT"];

export default async function IncomePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireRole(...OFFICER_ROLES);
  const { year: label } = await searchParams;
  const year = (label ? await db.financialYear.findUnique({ where: { label } }) : null) ?? (await currentYear());
  if (!year) return <p>No year.</p>;
  const [flows, investments, settlements, opening] = await Promise.all([
    db.ledgerEntry.groupBy({ by: ["type"], where: { ...LIVE, period: { yearId: year.id } }, _sum: { amountKobo: true } }),
    db.investment.findMany({ where: { status: "MATURED", returnedOn: { gte: year.startDate, lte: year.endDate } } }),
    db.settlement.aggregate({ where: { yearId: year.id }, _sum: { dividendKobo: true }, _count: true }),
    openingBank(year),
  ]);
  const sum = (t: EntryType) => flows.find((f) => f.type === t)?._sum.amountKobo ?? 0n;
  const moneyIn = IN.reduce((t, x) => t + sum(x), 0n);
  const moneyOut = OUT.reduce((t, x) => t + sum(x), 0n);
  const profit = investments.reduce((t, i) => t + (i.amountReturnedKobo ?? 0n) - i.amountPlacedKobo, 0n);
  const earned = sum("INTEREST_PAID") + profit + sum("OTHER_INCOME") - sum("EXPENSE");
  const row = (label: string, k: bigint, strong = false) => (
    <div className={`flex justify-between gap-4 border-t border-line py-1.5 ${strong ? "font-semibold" : ""}`}><dt>{label}</dt><dd className="tabular-nums">{formatNaira(k)}</dd></div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end print:hidden"><PrintButton /></div>
      <article className="rounded-xl border border-line bg-white p-5 text-sm print:border-0 print:p-0">
        <Letterhead title={`Income and bank summary ${year.label}`} subtitle={year.status === "CLOSED" ? "Year closed" : "Year still open: figures to date"} />
        <div className="grid gap-8 md:grid-cols-2">
          <section>
            <h2 className="mb-2 font-display text-lg text-forest">GT Bank account</h2>
            <dl>
              {opening !== null ? row("Opening balance, 1 March", opening, true) : null}
              {IN.map((t) => <div key={t}>{row(`+ ${ENTRY_LABELS[t]}`, sum(t))}</div>)}
              {OUT.map((t) => <div key={t}>{row(`− ${ENTRY_LABELS[t]}`, sum(t))}</div>)}
              {opening !== null ? row("Balance by the app", opening + moneyIn - moneyOut, true) : row("Money in − money out", moneyIn - moneyOut, true)}
            </dl>
          </section>
          <section>
            <h2 className="mb-2 font-display text-lg text-forest">What the union earned</h2>
            <dl>
              {row("Interest paid by borrowers", sum("INTEREST_PAID"))}
              {row("Investment profit", profit)}
              {row("Other income", sum("OTHER_INCOME"))}
              {row("− Expenses", sum("EXPENSE"))}
              {row("Earned", earned, true)}
              {settlements._count ? row(`Dividend paid (${year.dividendRateBps !== null ? (year.dividendRateBps / 100).toFixed(2) : "?"}%)`, settlements._sum.dividendKobo ?? 0n) : null}
              {settlements._count ? row("Left after dividend", earned - (settlements._sum.dividendKobo ?? 0n), true) : null}
            </dl>
            <p className="mt-3 text-xs text-muted">Membership fees ({formatNaira(sum("MEMBERSHIP_FEE"))}) pay for running costs such as SMS and are not shared as dividend. Interest charged but not yet paid is not counted until it is paid.</p>
          </section>
        </div>
      </article>
    </div>
  );
}
