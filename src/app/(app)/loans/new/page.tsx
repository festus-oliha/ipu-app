import type { Metadata } from "next";
import { Card, Notice, PageHeader } from "@/components/ui";
import { MEMBER_ADMIN_ROLES, PAYMENT_ROLES, hasRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PENDING_STATUSES, positionsThrough } from "@/lib/loans";
import { todayLagos } from "@/lib/periods";
import { DEFAULT_RULES, loanLimit } from "@/lib/rules";
import { LoanRequestForm, type BorrowerOption } from "./LoanRequestForm";

export const metadata: Metadata = { title: "Request a loan" };

export default async function NewLoanPage() {
  const user = await requireUser();
  const officer = hasRole(user, ...PAYMENT_ROLES, ...MEMBER_ADMIN_ROLES);
  const month = Number(todayLagos().slice(5, 7));

  const members = await db.member.findMany({ where: { status: "ACTIVE" }, orderBy: { memberNo: "asc" } });
  const positions = await positionsThrough(new Date(Date.UTC(2100, 0, 1)));
  const pending = await db.loan.groupBy({ by: ["borrowerId"], where: { status: { in: PENDING_STATUSES } }, _sum: { amountKobo: true } });
  const pendingBy = new Map(pending.map((p) => [p.borrowerId, p._sum.amountKobo ?? 0n]));

  const label = (m: (typeof members)[number]) => `${m.memberNo} · ${[m.title, m.fullName].filter(Boolean).join(" ")}`;
  const option = (m: (typeof members)[number]): BorrowerOption => ({
    label: label(m),
    limitKobo: loanLimit(m.usualMonthlyKobo).toString(),
    usedKobo: ((positions.get(m.id)?.principal ?? 0n) + (pendingBy.get(m.id) ?? 0n)).toString(),
  });

  const me = members.find((m) => m.id === user.member?.id);
  const closed = !DEFAULT_RULES.loanMonths.includes(month);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Loans" title={officer ? "Enter a loan request" : "Request a loan"} />
      {closed ? (
        <Notice tone="warning">New loans are not given in January and February. Requests open again in March.</Notice>
      ) : !officer && !me ? (
        <Notice tone="warning">Your login is not linked to an active member record. Ask the Secretary.</Notice>
      ) : (
        <Card>
          <LoanRequestForm
            borrowers={officer ? members.map(option) : undefined}
            self={officer ? undefined : option(me!)}
            guarantors={members.filter((m) => officer || m.id !== me?.id).map(label)}
          />
        </Card>
      )}
    </div>
  );
}
