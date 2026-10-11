"use client";

import { useActionState, useState } from "react";
import type { ReverseState } from "@/app/(app)/office/payments/actions";
import { buttonStyles } from "./ui";

/** "Reverse" link that opens a reason box; the original entry is never deleted. */
export function ReverseForm({ action }: { action: (prev: ReverseState, form: FormData) => Promise<ReverseState> }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ReverseState, FormData>(action, {});

  if (state.ok) return <span className="text-xs font-semibold text-muted">Reversed</span>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="-ml-2 min-h-11 px-2 text-xs font-semibold text-danger underline-offset-2 hover:underline">
        Reverse
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2 py-2">
      <label className="text-xs font-semibold">
        Why is this entry wrong?
        <input name="reason" required minLength={5} className="mt-1 h-10 w-full rounded-lg border border-line bg-ivory px-2 text-sm" />
      </label>
      {state.error ? <p role="alert" className="text-xs text-danger">{state.error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${buttonStyles.danger} h-9 px-3 text-xs`}>
          {pending ? "Reversing…" : "Confirm reversal"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={`${buttonStyles.secondary} h-9 px-3 text-xs`}>
          Cancel
        </button>
      </div>
    </form>
  );
}
