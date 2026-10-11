"use client";

import { useActionState } from "react";
import { FormError } from "@/components/Field";
import { Notice, buttonStyles } from "@/components/ui";
import type { ReviewState } from "./actions";

type Action = (prev: ReviewState, form: FormData) => Promise<ReviewState>;
const input = "h-11 w-full rounded-lg border border-line bg-ivory px-3 text-base aria-[invalid=true]:border-danger";

export function ConfirmForm({ action, defaults }: { action: Action; defaults: Record<string, string> }) {
  const [state, formAction, pending] = useActionState<ReviewState, FormData>(action, {});
  if (state.done) return <Notice tone="success">{state.done}</Notice>;
  const e = state.errors ?? {};
  const field = (name: string, label: string, type = "text") => (
    <label className="flex flex-col gap-1 text-sm font-semibold">
      {label}
      <input name={name} type={type} inputMode={type === "text" ? "decimal" : undefined} defaultValue={defaults[name]} aria-invalid={e[name] ? true : undefined} className={input} />
      {e[name] ? <span className="font-normal text-danger">{e[name]}</span> : null}
    </label>
  );
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        {field("contribution", "Contribution ₦")}
        {field("membershipFee", "Membership fee ₦")}
        {field("interestPaid", "Interest ₦")}
        {field("loanRepaid", "Loan repaid ₦")}
        {field("date", "Date in bank", "date")}
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Bank reference
          <input name="bankRef" className={input} />
        </label>
      </div>
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${buttonStyles.primary} self-start`}>{pending ? "Confirming…" : "Confirm, money is in the bank"}</button>
    </form>
  );
}

export function RejectForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState<ReviewState, FormData>(action, {});
  if (state.done) return <Notice>{state.done}</Notice>;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Reason (sent to the member by SMS)
        <input name="reason" placeholder="e.g. Not on the bank statement" className={input} />
      </label>
      <FormError message={state.errors?.reason ?? state.error} />
      <button type="submit" disabled={pending} className={`${buttonStyles.danger} self-start`}>{pending ? "Rejecting…" : "Reject receipt"}</button>
    </form>
  );
}
