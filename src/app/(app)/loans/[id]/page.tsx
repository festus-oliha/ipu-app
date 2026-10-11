import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, Stat } from "@/components/ui";
import { MEMBER_ADMIN_ROLES, OFFICER_ROLES, hasRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { LOAN_STATUS_LABELS, memberPosition } from "@/lib/loans";
import { officerNames } from "@/lib/ledger";
import { formatNaira } from "@/lib/money";
import { formatDate, todayLagos } from "@/lib/periods";
import { loanLimit, monthlyInterest } from "@/lib/rules";
import { disburseLoan, guarantorDecision, presidentDecision, treasurerDecision } from "../actions";
import { DecisionForm, DisburseForm, GuarantorForm } from "./StepForms";

export const metadata: Metadata = { title: "Loan" };

const STEP_NAMES = { GUARANTOR: "Guarantor", PRESIDENT: "President", TREASURER: "Treasurer", EXCEPTION: "Exception" } as const;
const name = (m: { title: string | null; fullName: string }) => [m.title, m.fullName].filter(Boolean).join(" ");

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const loan = await db.loan.findUnique({
    where: { id },
    include: { borrower: true, guarantor: true, approvals: { orderBy: { at: "asc" } } },
  });
  if (!loan) notFound();

  const isBorrower = user.member?.id === loan.borrowerId;
  const isGuarantor = user.member?.id === loan.guarantorId;
  const isOfficer = hasRole(user, ...OFFICER_ROLES);
  if (!isBorrower && !isGuarantor && !isOfficer) notFound();

  const names = await officerNames([loan.requestedById, ...loan.approvals.map((a) => a.byId)]);
  const position = await memberPosition(loan.borrowerId);
  const limit = loanLimit(loan.borrower.usualMonthlyKobo);
  const exceptionDone = loan.approvals.some((a) => a.step === "EXCEPTION" && a.decision === "APPROVED");
  const presidentId = loan.approvals.find((a) => a.step === "PRESIDENT")?.byId;

  // Which action box (if any) this person sees now.
  let panel: React.ReactNode = null;
  if (loan.status === "REQUESTED" && (isGuarantor || (hasRole(user, ...MEMBER_ADMIN_ROLES) && !isBorrower))) {
    panel = (
      <Card title={isGuarantor ? "Will you guarantee this loan?" : "Record the guarantor's answer"}>
        <GuarantorForm action={guarantorDecision.bind(null, loan.id)} onPaper={!isGuarantor} />
      </Card>
    );
  } else if (loan.status === "GUARANTOR_ACCEPTED" && hasRole(user, "PRESIDENT") && !isBorrower) {
    panel = (
      <Card title="President's approval">
        <DecisionForm action={presidentDecision.bind(null, loan.id)} approveLabel="Approve" rejectLabel="Do not approve" exception={loan.isException && !exceptionDone ? "optional" : undefined} />
      </Card>
    );
  } else if (loan.status === "PRESIDENT_APPROVED" && hasRole(user, "TREASURER") && !isBorrower && presidentId !== user.id) {
    panel = (
      <Card title="Treasurer's approval">
        <DecisionForm action={treasurerDecision.bind(null, loan.id)} approveLabel="Approve" rejectLabel="Do not approve" exception={loan.isException && !exceptionDone ? "required" : undefined} />
      </Card>
    );
  } else if (loan.status === "APPROVED" && hasRole(user, "TREASURER") && !isBorrower) {
    panel = (
      <Card title="Pay out the loan">
        <p className="mb-3 text-sm">
          Transfer {formatNaira(loan.amountKobo, { compact: true })} to {loan.borrower.bankName ?? "the member's bank"}
          {loan.borrower.accountNumber ? `, account ${loan.borrower.accountNumber}` : ""}, then record it here.
        </p>
        <DisburseForm action={disburseLoan.bind(null, loan.id)} today={todayLagos()} />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={`Loan · ${LOAN_STATUS_LABELS[loan.status]}`} title={`${formatNaira(loan.amountKobo, { compact: true })} for ${name(loan.borrower)}`} />
      <p className="-mt-3 text-sm text-muted">
        {loan.borrower.memberNo} · Guarantor: {name(loan.guarantor)} ({loan.guarantor.memberNo}) · For: {loan.purpose}
      </p>

      {loan.isException ? (
        <div role="status" className="rounded-lg border border-gold/50 bg-gold/10 p-4 text-sm">
          Above the loan limit of {formatNaira(limit, { compact: true })}.{" "}
          {exceptionDone ? `Approved as an exception: ${loan.exceptionReason}. Guarantor told ${loan.guarantorToldAt ? formatDate(loan.guarantorToldAt) : ""}.` : "Needs exception approval by the President or Treasurer."}
        </div>
      ) : null}

      {panel}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Loan balance now" value={formatNaira(position.principal, { compact: true })} note="All of this member's loans" />
        <Stat
          label={position.interestOwed >= 0n ? "Interest owed" : "Interest credit"}
          value={formatNaira(position.interestOwed < 0n ? -position.interestOwed : position.interestOwed, { compact: true })}
          note="Due by the 15th"
        />
        <Stat label="Monthly interest on this loan" value={formatNaira(monthlyInterest(loan.amountKobo), { compact: true })} note="₦25 per ₦1,000" />
      </div>

      <Card title="Steps">
        <ol className="flex flex-col gap-3 text-sm">
          <li>
            <span className="font-semibold">Requested</span> · {formatDate(loan.createdAt)} by {names.get(loan.requestedById)}
          </li>
          {loan.approvals.map((a) => (
            <li key={a.id}>
              <span className={`font-semibold ${a.decision === "REJECTED" ? "text-danger" : "text-forest"}`}>
                {STEP_NAMES[a.step]}: {a.decision === "APPROVED" ? (a.step === "GUARANTOR" ? "accepted" : "approved") : a.step === "GUARANTOR" ? "declined" : "not approved"}
              </span>{" "}
              · {formatDate(a.at)} by {names.get(a.byId)}
              {a.reason ? <span className="block text-muted">“{a.reason}”</span> : null}
            </li>
          ))}
          {loan.disbursedOn ? (
            <li>
              <span className="font-semibold text-forest">Paid out</span> · {formatDate(loan.disbursedOn)} · Ref {loan.bankRef}
            </li>
          ) : null}
          {loan.closedAt ? <li><span className="font-semibold text-forest">Fully repaid</span> · {formatDate(loan.closedAt)}</li> : null}
        </ol>
      </Card>

      {isOfficer ? (
        <p className="text-sm">
          <Link href={`/office/members/${loan.borrowerId}`} className="font-semibold text-forest underline">Open {name(loan.borrower)}&apos;s record</Link>
        </p>
      ) : null}
    </div>
  );
}
