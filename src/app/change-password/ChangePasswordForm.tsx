"use client";

import { useActionState } from "react";
import { Field, FormError, SubmitButton } from "@/components/Field";
import { changePassword, type FormState } from "../login/actions";

export function ChangePasswordForm({ first }: { first: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      {first ? (
        <p className="rounded-lg bg-sand p-3 text-sm text-ink">
          Welcome. Please replace the password you were given with one only you know.
        </p>
      ) : null}
      <Field label={first ? "Password you were given" : "Current password"} name="current" type="password" autoComplete="current-password" required />
      <Field label="New password" name="next" type="password" autoComplete="new-password" minLength={8} hint="At least 8 characters." required />
      <Field label="Type the new password again" name="confirm" type="password" autoComplete="new-password" required />
      <FormError message={state.error} />
      <SubmitButton pending={pending}>Save password</SubmitButton>
    </form>
  );
}
