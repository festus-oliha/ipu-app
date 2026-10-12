"use client";

import { useActionState } from "react";
import type { FormResult } from "@/components/ActionForm";
import { Notice, buttonStyles } from "@/components/ui";
import { FormError } from "@/components/Field";
import { changeMyPassword, updateMyDetails, type DetailsResult } from "./actions";

const input = "h-11 w-full rounded-lg border border-line bg-ivory px-3 text-base font-normal aria-[invalid=true]:border-danger";

function Box({ label, name, error, hint, ...rest }: { label: string; name: string; error?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold">
      {label}
      <input name={name} aria-invalid={error ? true : undefined} className={input} {...rest} />
      {error ? <span className="text-xs font-medium text-danger">{error}</span> : hint ? <span className="text-xs font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

export type MyDetails = { email: string; occupation: string; address: string; emergencyName: string; emergencyPhone: string };

export function DetailsForm({ details }: { details: MyDetails }) {
  const [state, action, pending] = useActionState<DetailsResult, FormData>(updateMyDetails, {});
  const e = state.errors ?? {};
  // React clears a form after it is sent; show the saved details, or what was typed if there was a mistake.
  const v = { ...details, ...state.values };
  return (
    <form action={action} className="flex flex-col gap-3" key={JSON.stringify(v)}>
      {state.done ? <Notice tone="success">{state.done}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Box label="Email" name="email" type="email" autoComplete="email" defaultValue={v.email} error={e.email} hint="For loan reports and statements." />
        <Box label="Occupation" name="occupation" defaultValue={v.occupation} />
        <div className="sm:col-span-2"><Box label="Home address" name="address" autoComplete="street-address" defaultValue={v.address} /></div>
        <Box label="Next of kin / emergency contact" name="emergencyName" defaultValue={v.emergencyName} />
        <Box label="Their phone number" name="emergencyPhone" type="tel" inputMode="tel" defaultValue={v.emergencyPhone} error={e.emergencyPhone} />
      </div>
      <FormError message={state.error} />
      <div><button type="submit" disabled={pending} className={buttonStyles.primary}>{pending ? "Saving…" : "Save my details"}</button></div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<FormResult, FormData>(changeMyPassword, {});
  const e = state.errors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3" key={state.done}>
      {state.done ? <Notice tone="success">{state.done}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Box label="Current password" name="current" type="password" autoComplete="current-password" error={e.current} required />
        <Box label="New password" name="next" type="password" autoComplete="new-password" minLength={8} error={e.next} hint="At least 8 characters." required />
        <Box label="New password again" name="confirm" type="password" autoComplete="new-password" error={e.confirm} required />
      </div>
      <FormError message={state.error} />
      <div><button type="submit" disabled={pending} className={buttonStyles.secondary}>{pending ? "Saving…" : "Change password"}</button></div>
    </form>
  );
}
