"use client";

import { useActionState, useState } from "react";
import { FormError, SubmitButton } from "@/components/Field";
import { Notice } from "@/components/ui";
import { requestLoan, type LoanFormState } from "../actions";

const input =
  "h-12 w-full rounded-lg border border-line bg-ivory px-3 text-base text-ink focus:border-forest aria-[invalid=true]:border-danger";

export type BorrowerOption = { label: string; limitKobo: string; usedKobo: string };

const naira = (kobo: bigint) => `₦${(kobo / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

function parseAmount(text: string): bigint | null {
  const cleaned = text.replace(/[₦,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [w, f = ""] = cleaned.split(".");
  return BigInt(w) * 100n + BigInt(f.padEnd(2, "0"));
}

export function LoanRequestForm({
  borrowers,
  self,
  guarantors,
  terms,
}: {
  /** The union's loan terms in plain words (from Settings). */
  terms: string;
  /** Officers choose the borrower; members borrow for themselves (`self`). */
  borrowers?: BorrowerOption[];
  self?: BorrowerOption;
  guarantors: string[];
}) {
  const [state, action, pending] = useActionState<LoanFormState, FormData>(requestLoan, {});
  const values = state.values ?? {};
  const errors = state.errors ?? {};
  const [borrowerText, setBorrowerText] = useState(values.borrower ?? "");
  const [amountText, setAmountText] = useState(values.amount ?? "");

  const borrower = self ?? borrowers?.find((b) => b.label === borrowerText);
  const amount = parseAmount(amountText);
  const room = borrower ? BigInt(borrower.limitKobo) - BigInt(borrower.usedKobo) : null;
  const overLimit = borrower && amount !== null && room !== null && amount > room;

  const err = (name: string) =>
    errors[name] ? <p id={`${name}-error`} className="text-sm text-danger">{errors[name]}</p> : null;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {borrowers ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="borrower" className="text-sm font-semibold">Member asking for the loan</label>
          <input id="borrower" name="borrower" list="borrower-list" value={borrowerText} onChange={(e) => setBorrowerText(e.target.value)} autoComplete="off" placeholder="Type a name or IPU number" aria-invalid={errors.borrower ? true : undefined} className={input} />
          <datalist id="borrower-list">{borrowers.map((b) => <option key={b.label} value={b.label} />)}</datalist>
          {err("borrower")}
        </div>
      ) : null}

      {borrower ? (
        <div className="grid gap-3 rounded-lg bg-sand p-4 text-sm sm:grid-cols-3">
          <p><span className="block text-xs text-muted uppercase">Loan limit</span><span className="font-semibold">{naira(BigInt(borrower.limitKobo))}</span></p>
          <p><span className="block text-xs text-muted uppercase">Already owed or requested</span><span className="font-semibold">{naira(BigInt(borrower.usedKobo))}</span></p>
          <p><span className="block text-xs text-muted uppercase">Room left</span><span className="font-semibold">{naira(room! > 0n ? room! : 0n)}</span></p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="amount" className="text-sm font-semibold">Amount (₦)</label>
          <input id="amount" name="amount" inputMode="decimal" placeholder="150,000" value={amountText} onChange={(e) => setAmountText(e.target.value)} aria-invalid={errors.amount ? true : undefined} className={input} />
          {err("amount") ?? (amount ? <p className="text-xs text-muted">Interest: {naira((amount * 25n) / 1000n)} a month while the full amount is owed.</p> : null)}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="guarantor" className="text-sm font-semibold">Guarantor</label>
          <input id="guarantor" name="guarantor" list="guarantor-list" defaultValue={values.guarantor ?? ""} autoComplete="off" placeholder="Type a name or IPU number" aria-invalid={errors.guarantor ? true : undefined} className={input} />
          <datalist id="guarantor-list">{guarantors.map((g) => <option key={g} value={g} />)}</datalist>
          {err("guarantor") ?? <p className="text-xs text-muted">An active member who agrees to stand for you. Each person can guarantee at most 2 loans.</p>}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="purpose" className="text-sm font-semibold">What is the loan for?</label>
        <input id="purpose" name="purpose" defaultValue={values.purpose ?? ""} placeholder="e.g. Restock shop goods" aria-invalid={errors.purpose ? true : undefined} className={input} />
        {err("purpose")}
      </div>

      {overLimit ? (
        <Notice tone="warning">
          This is above the loan limit. It can only be given as an exception approved by the President or Treasurer, and the guarantor will be told.
        </Notice>
      ) : null}

      <Notice>
        {terms}
      </Notice>

      <FormError message={state.error} />
      <div className="max-w-xs">
        <SubmitButton pending={pending}>Send loan request</SubmitButton>
      </div>
    </form>
  );
}
