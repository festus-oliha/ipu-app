"use client";

import { useActionState, useState } from "react";
import { FormError } from "@/components/Field";
import { Notice, buttonStyles } from "@/components/ui";
import type { StepState } from "../actions";

type Action = (prev: StepState, form: FormData) => Promise<StepState>;
const input = "h-11 w-full rounded-lg border border-line bg-ivory px-3 text-base";

/** Approve / not approve, with a reason; optional exception tick. */
export function DecisionForm({
  action, approveLabel, rejectLabel, exception, intro,
}: { action: Action; approveLabel: string; rejectLabel: string; exception?: "optional" | "required"; intro?: string }) {
  const [state, formAction, pending] = useActionState<StepState, FormData>(action, {});
  const [choice, setChoice] = useState<string>("");
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {intro ? <p className="text-sm text-ink">{intro}</p> : null}
      {exception ? (
        <label className="flex min-h-11 items-start gap-3 rounded-lg border border-gold/60 bg-gold/10 p-3">
          <input type="checkbox" name="exception" className="mt-1 size-5 accent-forest" />
          <span className="text-sm">
            <span className="font-semibold">Approve as an exception above the loan limit.</span>{" "}
            {exception === "required" ? "Needed before this loan can be approved." : "Or leave it for the Treasurer."} The guarantor will be told. Give the reason below.
          </span>
        </label>
      ) : null}
      <label className="text-sm font-semibold">
        Reason or note {choice === "approve" && !exception ? "(optional)" : ""}
        <input name="reason" className={`${input} mt-1.5`} />
      </label>
      <FormError message={state.error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="approve" onClick={() => setChoice("approve")} disabled={pending} className={buttonStyles.primary}>
          {approveLabel}
        </button>
        <button type="submit" name="decision" value="reject" onClick={() => setChoice("reject")} disabled={pending} className={buttonStyles.danger}>
          {rejectLabel}
        </button>
      </div>
    </form>
  );
}

export function GuarantorForm({ action, onPaper }: { action: Action; onPaper: boolean }) {
  const [state, formAction, pending] = useActionState<StepState, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {onPaper ? (
        <Notice>Use this only if the guarantor has signed the paper loan form (page 2, section C).</Notice>
      ) : (
        <p className="text-sm">
          By accepting, you agree that if the borrower does not repay, after their own savings are used, your savings may be used to cover
          part or all of what is still owed. You will get progress updates every quarter.
        </p>
      )}
      <label className="text-sm font-semibold">
        Note (optional)
        <input name="reason" className={`${input} mt-1.5`} />
      </label>
      <FormError message={state.error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="accept" disabled={pending} className={buttonStyles.primary}>
          {onPaper ? "Guarantor signed: accept" : "I accept to guarantee"}
        </button>
        <button type="submit" name="decision" value="decline" disabled={pending} className={buttonStyles.danger}>
          {onPaper ? "Guarantor declined" : "I decline"}
        </button>
      </div>
    </form>
  );
}

export function DisburseForm({ action, today }: { action: Action; today: string }) {
  const [state, formAction, pending] = useActionState<StepState, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">
          Date paid out
          <input type="date" name="date" defaultValue={today} max={today} className={`${input} mt-1.5`} />
        </label>
        <label className="text-sm font-semibold">
          Bank transfer reference
          <input name="bankRef" autoComplete="off" className={`${input} mt-1.5`} />
        </label>
      </div>
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${buttonStyles.primary} self-start`}>
        {pending ? "Recording…" : "Record payout"}
      </button>
    </form>
  );
}
