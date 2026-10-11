import type { Metadata } from "next";
import { ActionForm } from "@/components/ActionForm";
import { Card, Notice, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatNaira } from "@/lib/money";
import { currentYear, formatDate } from "@/lib/periods";
import { settle } from "@/lib/rules";
import { memberFigures } from "@/lib/settlement";
import { requestExit } from "./actions";

export const metadata: Metadata = { title: "Leave the union" };

const STATUS = { REQUESTED: "Waiting for the President or Treasurer", APPROVED: "Approved, waiting for the Treasurer to pay", PAID: "Paid", REJECTED: "Not approved" } as const;

export default async function ExitPage() {
  const user = await requireUser();
  const year = await currentYear();
  if (!user.member || !year) return <p>Your login is not linked to a member record.</p>;
  const exit = await db.exit.findFirst({ where: { memberId: user.member.id }, orderBy: { requestedOn: "desc" } });
  const f = await memberFigures(user.member.id, year);
  const s = settle({ contributions: f.contributions, dividend: 0n, principal: f.position.principal, interestOwed: f.position.interestOwed });
  const open = exit && (exit.status === "REQUESTED" || exit.status === "APPROVED" || exit.status === "PAID");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="My account" title="Leave the union" />
      <Card title="What you would receive">
        <dl className="grid gap-2 text-sm sm:max-w-md">
          <div className="flex justify-between"><dt>Contributions this year</dt><dd className="font-semibold tabular-nums">{formatNaira(f.contributions)}</dd></div>
          {s.credit ? <div className="flex justify-between"><dt>Interest credit refunded</dt><dd className="font-semibold tabular-nums">+{formatNaira(s.credit)}</dd></div> : null}
          {s.interestDeducted ? <div className="flex justify-between"><dt>Interest owed</dt><dd className="font-semibold tabular-nums">−{formatNaira(s.interestDeducted)}</dd></div> : null}
          {s.loanDeducted ? <div className="flex justify-between"><dt>Loan balance</dt><dd className="font-semibold tabular-nums">−{formatNaira(s.loanDeducted)}</dd></div> : null}
          <div className="flex justify-between border-t border-line pt-2"><dt className="font-semibold">Payout</dt><dd className="font-semibold tabular-nums">{formatNaira(s.payout)}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-muted">Members who leave get back their contributions only; the year&apos;s dividend is forfeited and membership fees are not refunded.</p>
        {s.shortfall ? <Notice tone="warning">You owe {formatNaira(s.shortfall)} more than your savings. This must be paid before you can leave.</Notice> : null}
      </Card>
      {exit ? (
        <Card title="Your exit request">
          <p className="text-sm">Requested {formatDate(exit.requestedOn)} · <span className="font-semibold">{STATUS[exit.status]}</span></p>
          {exit.rejectReason ? <p className="mt-1 text-sm text-danger">Reason: {exit.rejectReason}</p> : null}
          {exit.status === "PAID" && exit.payoutKobo !== null ? <p className="mt-1 text-sm">{formatNaira(exit.payoutKobo)} paid on {formatDate(exit.paidOn!)}.</p> : null}
        </Card>
      ) : null}
      {!open ? (
        <Card title="Ask to leave">
          <ActionForm action={requestExit} submit="Send exit request" tone="danger" fields={[{ name: "reason", label: "Why are you leaving?", wide: true }]} />
        </Card>
      ) : null}
    </div>
  );
}
