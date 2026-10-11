import { reverseEntry } from "@/app/(app)/office/payments/actions";
import { db } from "@/lib/db";
import { ENTRY_LABELS, officerNames } from "@/lib/ledger";
import { formatNaira } from "@/lib/money";
import { currentYear, formatDate } from "@/lib/periods";
import { ReverseForm } from "./ReverseForm";

/** A member's ledger rows for the open year, newest first. Reversed rows are struck through. */
export async function PaymentHistory({ memberId, canReverse = false }: { memberId: string; canReverse?: boolean }) {
  const year = await currentYear();
  if (!year) return <p className="text-sm text-muted">No open financial year.</p>;

  const entries = await db.ledgerEntry.findMany({
    where: { memberId, period: { yearId: year.id }, type: { not: "REVERSAL" } },
    include: { reversedBy: true, period: true },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  if (entries.length === 0) return <p className="text-sm text-muted">No payments recorded in {year.label} yet.</p>;

  const names = await officerNames(entries.flatMap((e) => [e.enteredById, e.reversedBy?.enteredById ?? e.enteredById]));

  return (
    <ul className="divide-y divide-line/70">
      {entries.map((e) => {
        const reversed = Boolean(e.reversedBy);
        return (
          <li key={e.id} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${reversed ? "text-muted line-through" : "text-ink"}`}>{ENTRY_LABELS[e.type]}</p>
              <p className="text-xs text-muted">
                {formatDate(e.date)}
                {e.bankRef ? ` · Ref ${e.bankRef}` : ""}
                {` · by ${names.get(e.enteredById)}`}
              </p>
              {reversed ? (
                <p className="mt-1 text-xs text-danger">
                  Reversed by {names.get(e.reversedBy!.enteredById)}: {e.reversedBy!.note}
                </p>
              ) : null}
              {canReverse && !reversed && e.period.status === "OPEN" ? <ReverseForm action={reverseEntry.bind(null, e.id)} /> : null}
            </div>
            <p className={`shrink-0 text-right text-base tabular-nums ${reversed ? "text-muted line-through" : "font-semibold text-ink"}`}>
              {formatNaira(e.amountKobo, { compact: true })}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
