import type { Metadata } from "next";
import { Card, Notice, PageHeader } from "@/components/ui";
import { MEMBER_ADMIN_ROLES, PAYMENT_ROLES, hasRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PENDING_STATUSES, positionsThrough } from "@/lib/loans";
import { todayLagos } from "@/lib/periods";
import { loanLimit, loanMonthsText } from "@/lib/rules";
import { settingsAt } from "@/lib/settings";
import { LoanRequestForm, type BorrowerOption } from "./LoanRequestForm";

export const metadata: Metadata = { title: "Request a loan" };

export default async function NewLoanPage() {
  const user = await requireUser();
  const officer = hasRole(user, ...PAYMENT_ROLES, ...MEMBER_ADMIN_ROLES);
  const month = Number(todayLagos().slice(5, 7));

  const rules = await settingsAt();
  const members = await db.member.findMany({ where: { status: "ACTIVE" }, orderBy: { memberNo: "asc" } });
  const positions = await positionsThrough(new Date(Date.UTC(2100, 0, 1)));
  const pending = await db.loan.groupBy({ by: ["borrowerId"], where: { status: { in: PENDING_STATUSES } }, _sum: { amountKobo: true } });
  const pendingBy = new Map(pending.map((p) => [p.borrowerId, p._sum.amountKobo ?? 0n]));

  const label = (m: (typeof members)[number]) => `${m.memberNo} · ${[m.title, m.fullName].filter(Boolean).join(" ")}`;
  const option = (m: (typeof members)[number]): BorrowerOption => ({
    label: label(m),
    limitKobo: loanLimit(m.usualMonthlyKobo, rules).toString(),
    usedKobo: ((positions.get(m.id)?.principal ?? 0n) + (pendingBy.get(m.id) ?? 0n)).toString(),
  });

  const me = members.find((m) => m.id === user.member?.id);
  const closed = !rules.loanMonths.includes(month);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Loans" title={officer ? "Enter a loan request" : "Request a loan"} />
      {closed ? (
        <Notice tone="warning">New loans are given from {loanMonthsText(rules)} only. Requests open again then.</Notice>
      ) : !officer && !me ? (
        <Notice tone="warning">Your login is not linked to an active member record. Ask the Secretary.</Notice>
      ) : (
        <Card>
          <LoanRequestForm
            terms={`Interest is ₦${rules.interestPer1000} for every ₦1,000 owed, each month, due by the 15th of the next month. Unpaid interest is added to the next month. Loans are given from ${loanMonthsText(rules)}. Anything unpaid at the end of February is taken from your savings.`}
            borrowers={officer ? members.map(option) : undefined}
            self={officer ? undefined : option(me!)}
            guarantors={members.filter((m) => officer || m.id !== me?.id).map(label)}
          />
        </Card>
      )}
    </div>
  );
}
