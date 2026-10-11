import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Card, PageHeader } from "@/components/ui";
import { MEMBER_ADMIN_ROLES, OFFICER_ROLES, hasRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatNaira } from "@/lib/money";
import { currentYear, formatDate, todayLagos } from "@/lib/periods";
import { settle } from "@/lib/rules";
import { memberFigures } from "@/lib/settlement";
import { decideExit, payExit, requestExit } from "../../exit/actions";

export const metadata: Metadata = { title: "Exits" };

const STATUS = { REQUESTED: "Waiting for decision", APPROVED: "Approved, to be paid", PAID: "Paid", REJECTED: "Not approved" } as const;

export default async function ExitsPage() {
  const user = await requireRole(...OFFICER_ROLES);
  const year = await currentYear();
  if (!year) return <p>No open financial year.</p>;
  const today = todayLagos();
  const exits = await db.exit.findMany({ include: { member: true }, orderBy: { requestedOn: "desc" } });
  const members = hasRole(user, ...MEMBER_ADMIN_ROLES) ? await db.member.findMany({ where: { status: { not: "EXITED" } }, orderBy: { memberNo: "asc" } }) : [];
  const live = new Map(
    await Promise.all(
      exits.filter((e) => e.status === "REQUESTED" || e.status === "APPROVED").map(async (e) => {
        const f = await memberFigures(e.memberId, year);
        return [e.id, { f, s: settle({ contributions: f.savings, dividend: 0n, principal: f.position.principal, interestOwed: f.position.interestOwed }) }] as const;
      }),
    ),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Office" title="Members leaving" />
      <p className="-mt-3 max-w-prose text-sm text-muted">
        A member who leaves gets back this year&apos;s contributions, less any loan and interest owed. No dividend. The President or Treasurer
        approves; the Treasurer records the transfer, and the member is then marked as exited.
      </p>
      {exits.length === 0 ? <Card><p className="text-sm text-muted">No exit requests.</p></Card> : null}
      {exits.map((e) => {
        const l = live.get(e.id);
        const self = e.member.userId === user.id;
        return (
          <Card key={e.id}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <Link href={`/office/members/${e.memberId}`} className="font-display text-xl text-forest">{[e.member.title, e.member.fullName].filter(Boolean).join(" ")}</Link>
                <p className="text-sm text-muted">{e.member.memberNo} · asked {formatDate(e.requestedOn)}{e.reason ? ` · “${e.reason}”` : ""}</p>
              </div>
              <span className="text-sm font-semibold">{STATUS[e.status]}</span>
            </div>
            {l ? (
              <p className="mb-3 text-sm">
                Savings {formatNaira(l.f.savings)}
                {l.s.credit ? ` + credit ${formatNaira(l.s.credit)}` : ""}
                {l.s.interestDeducted ? ` − interest ${formatNaira(l.s.interestDeducted)}` : ""}
                {l.s.loanDeducted ? ` − loan ${formatNaira(l.s.loanDeducted)}` : ""} = <span className="font-semibold">payout {formatNaira(l.s.payout)}</span>
                {l.s.shortfall ? <span className="block text-danger">Owes {formatNaira(l.s.shortfall)} more than their savings; must pay first.</span> : null}
              </p>
            ) : e.status === "PAID" ? (
              <p className="mb-3 text-sm">Paid {formatNaira(e.payoutKobo ?? 0n)} on {formatDate(e.paidOn!)}{e.bankRef ? ` · Ref ${e.bankRef}` : ""}</p>
            ) : e.rejectReason ? <p className="mb-3 text-sm text-danger">{e.rejectReason}</p> : null}
            {e.status === "REQUESTED" && hasRole(user, "PRESIDENT", "TREASURER") && !self ? (
              <ActionForm action={decideExit.bind(null, e.id)} fields={[{ name: "reason", label: "Reason (only if rejecting)", wide: true }]}
                buttons={[{ name: "decision", value: "approve", label: "Approve exit", tone: "primary" }, { name: "decision", value: "reject", label: "Reject", tone: "danger" }]} />
            ) : null}
            {e.status === "APPROVED" && hasRole(user, "TREASURER") && !self ? (
              <ActionForm action={payExit.bind(null, e.id)} submit="Record payout sent" fields={[
                { name: "date", label: "Date of transfer", type: "date", defaultValue: today, max: today },
                { name: "bankRef", label: "Bank reference" },
              ]} />
            ) : null}
          </Card>
        );
      })}
      {members.length ? (
        <Card title="Enter an exit for a member">
          <datalist id="exit-members">{members.map((m) => <option key={m.id} value={`${m.memberNo} · ${[m.title, m.fullName].filter(Boolean).join(" ")}`} />)}</datalist>
          <ExitRequest />
        </Card>
      ) : null}
    </div>
  );
}

function ExitRequest() {
  return (
    <ActionForm action={requestExit} submit="Send exit request" fields={[
      { name: "member", label: "Member (type a name or IPU number)", placeholder: "IPU-0007 · …", list: "exit-members", hint: "Pick from the list as you type" },
      { name: "reason", label: "Reason" },
    ]} />
  );
}
