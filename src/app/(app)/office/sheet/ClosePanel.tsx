"use client";

import { useActionState } from "react";
import { FormError } from "@/components/Field";
import { buttonStyles } from "@/components/ui";
import type { CloseState } from "./actions";

type Action = (prev: CloseState, form: FormData) => Promise<CloseState>;
const input = "h-11 w-full rounded-lg border border-line bg-ivory px-3 text-base";

export function OpeningForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState<CloseState, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="text-sm font-semibold">
        Bank balance on 1 March (₦), from the GT Bank statement
        <input name="opening" inputMode="decimal" placeholder="8,115,250" className={`${input} mt-1.5`} />
      </label>
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${buttonStyles.primary} self-start`}>{pending ? "Saving…" : "Save opening balance"}</button>
    </form>
  );
}

export function CloseForm({ action, expected }: { action: Action; expected: string }) {
  const [state, formAction, pending] = useActionState<CloseState, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <p className="text-sm">
        The app expects the bank balance at the end of this month to be <span className="font-semibold">{expected}</span>. Enter the balance on
        the bank statement. Closing charges each borrower&apos;s interest (₦25 per ₦1,000 still owed), due by the 15th of next month, and stops
        further payments being entered in this month.
      </p>
      <label className="text-sm font-semibold">
        Balance on the bank statement at month end (₦)
        <input key={state.statement ?? ""} name="statement" inputMode="decimal" defaultValue={state.statement} className={`${input} mt-1.5`} />
      </label>
      {state.difference ? (
        <label className="text-sm font-semibold">
          Explain the difference (e.g. bank charges, a transfer not yet entered)
          <input name="explanation" className={`${input} mt-1.5`} />
        </label>
      ) : null}
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${buttonStyles.primary} self-start`}>{pending ? "Closing…" : "Close month and charge interest"}</button>
    </form>
  );
}

export function SignButton({ action, label }: { action: () => Promise<CloseState>; label: string }) {
  const [state, formAction, pending] = useActionState<CloseState>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${buttonStyles.primary} self-start`}>{pending ? "Signing…" : label}</button>
    </form>
  );
}

export function ReopenForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState<CloseState, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="text-sm font-semibold">
        Reason for reopening (recorded in the change log)
        <input name="reason" className={`${input} mt-1.5`} />
      </label>
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${buttonStyles.danger} self-start`}>{pending ? "Reopening…" : "Reopen month"}</button>
    </form>
  );
}
