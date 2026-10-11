import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { PAYMENT_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { officerNames } from "@/lib/ledger";
import { positionsThrough } from "@/lib/loans";
import { formatNaira } from "@/lib/money";
import { formatDate } from "@/lib/periods";
import { confirmReceipt, rejectReceipt } from "./actions";
import { ConfirmForm, RejectForm } from "./ReviewForms";

export const metadata: Metadata = { title: "Receipts" };

const plain = (k: bigint) => (k === 0n ? "" : (Number(k) / 100).toLocaleString("en-NG"));
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function ReceiptsPage() {
  const user = await requireRole(...PAYMENT_ROLES);
  const [pending, recent] = await Promise.all([
    db.receipt.findMany({ where: { status: "PENDING" }, include: { member: true }, orderBy: { createdAt: "asc" } }),
    db.receipt.findMany({ where: { status: { not: "PENDING" } }, include: { member: true }, orderBy: { checkedAt: "desc" }, take: 15 }),
  ]);
  const positions = await positionsThrough(new Date(Date.UTC(2100, 0, 1)));
  const names = await officerNames(recent.map((r) => r.checkedById!).filter(Boolean));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Office" title="Receipts to check" />
      <p className="-mt-3 max-w-prose text-sm text-muted">
        Open each receipt, find the money on the GT Bank statement, then confirm it (correcting the split if the member chose wrongly) or
        reject it with a reason. A month cannot be closed while it has receipts waiting.
      </p>
      {pending.length === 0 ? <Card><p className="text-sm text-muted">No receipts waiting.</p></Card> : null}
      {pending.map((r) => {
        const pos = positions.get(r.memberId);
        const own = r.member.userId === user.id;
        return (
          <Card key={r.id}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-xl text-forest">{[r.member.title, r.member.fullName].filter(Boolean).join(" ")}</p>
                <p className="text-sm text-muted">
                  {r.member.memberNo} · {formatNaira(r.amountKobo)} paid {formatDate(r.paidOn)} · uploaded {formatDate(r.createdAt)}
                </p>
                {pos && pos.principal > 0n ? (
                  <p className="text-sm text-muted">Loan balance {formatNaira(pos.principal, { compact: true })}, interest {pos.interestOwed >= 0n ? "owed" : "credit"} {formatNaira(pos.interestOwed < 0n ? -pos.interestOwed : pos.interestOwed, { compact: true })}</p>
                ) : null}
              </div>
              <a href={`/files/receipts/${r.id}`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold hover:bg-sand">
                Open receipt ↗
              </a>
            </div>
            {own ? (
              <p className="text-sm text-muted">This is your own receipt. Another officer must check it.</p>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                <ConfirmForm
                  action={confirmReceipt.bind(null, r.id)}
                  defaults={{ contribution: plain(r.contributionKobo), membershipFee: plain(r.otherKobo), interestPaid: plain(r.interestKobo), loanRepaid: plain(r.repaymentKobo), date: iso(r.paidOn) }}
                />
                <RejectForm action={rejectReceipt.bind(null, r.id)} />
              </div>
            )}
          </Card>
        );
      })}
      {recent.length ? (
        <Card title="Recently checked">
          <ul className="divide-y divide-line">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2.5 text-sm">
                <span>
                  <Link href={`/office/members/${r.memberId}`} className="font-semibold text-forest">{r.member.fullName}</Link> · {formatNaira(r.amountKobo, { compact: true })} · {formatDate(r.paidOn)}
                </span>
                <span className={r.status === "REJECTED" ? "text-danger" : "text-forest"}>
                  {r.status === "REJECTED" ? `Rejected: ${r.rejectReason}` : "Confirmed"} · {names.get(r.checkedById!)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
