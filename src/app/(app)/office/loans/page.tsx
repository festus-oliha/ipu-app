import type { Metadata } from "next";
import Link from "next/link";
import type { LoanStatus, Role } from "@/generated/prisma/enums";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { OFFICER_ROLES, PAYMENT_ROLES, hasRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { LOAN_STATUS_LABELS } from "@/lib/loans";
import { formatNaira } from "@/lib/money";
import { formatDate } from "@/lib/periods";

export const metadata: Metadata = { title: "Loans" };

const GROUPS: { title: string; statuses: LoanStatus[]; role?: Role }[] = [
  { title: "Waiting for the guarantor", statuses: ["REQUESTED"] },
  { title: "Waiting for the President", statuses: ["GUARANTOR_ACCEPTED"], role: "PRESIDENT" },
  { title: "Waiting for the Treasurer", statuses: ["PRESIDENT_APPROVED"], role: "TREASURER" },
  { title: "Approved — to be paid out", statuses: ["APPROVED"], role: "TREASURER" },
  { title: "Active loans", statuses: ["DISBURSED"] },
  { title: "Finished or not approved", statuses: ["CLOSED", "REJECTED", "DEFAULTED"] },
];

export default async function LoansPage() {
  const user = await requireRole(...OFFICER_ROLES);
  const loans = await db.loan.findMany({ include: { borrower: true, guarantor: true }, orderBy: { createdAt: "desc" } });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Office" title="Loans">
        {hasRole(user, ...PAYMENT_ROLES) ? <LinkButton href="/loans/new">Enter a loan request</LinkButton> : null}
      </PageHeader>
      {GROUPS.map((g) => {
        const list = loans.filter((l) => g.statuses.includes(l.status));
        if (list.length === 0 && g.statuses.includes("CLOSED")) return null;
        const mine = g.role && hasRole(user, g.role);
        return (
          <Card key={g.title} title={`${g.title} (${list.length})`} className={mine && list.length ? "border-gold" : ""}>
            {list.length === 0 ? (
              <p className="text-sm text-muted">None.</p>
            ) : (
              <ul className="divide-y divide-line/70">
                {list.map((l) => (
                  <li key={l.id}>
                    <Link href={`/loans/${l.id}`} className="flex items-start justify-between gap-4 py-3 hover:bg-ivory">
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-forest">{[l.borrower.title, l.borrower.fullName].filter(Boolean).join(" ")}</span>
                        <span className="block text-xs text-muted">
                          {l.borrower.memberNo} · Guarantor {l.guarantor.fullName} · {formatDate(l.disbursedOn ?? l.createdAt)}
                          {l.isException ? " · Exception" : ""}
                          {g.statuses.length > 1 ? ` · ${LOAN_STATUS_LABELS[l.status]}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-base font-semibold tabular-nums">{formatNaira(l.amountKobo, { compact: true })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
