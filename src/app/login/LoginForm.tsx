"use client";

import { useActionState } from "react";
import { Field, FormError, SubmitButton } from "@/components/Field";
import { login, type FormState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(login, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        label="Phone number"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="0803 445 3367"
        defaultValue={state.phone}
        required
      />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <FormError message={state.error} />
      <SubmitButton pending={pending}>Sign in</SubmitButton>
      <p className="text-center text-sm text-muted">
        Forgot your password? Ask the Admin or Secretary to reset it.
      </p>
    </form>
  );
}
