"use client";

import { useActionState } from "react";
import { Field, FormError, SubmitButton } from "@/components/Field";
import { login, type FormState } from "./actions";

const adminDisplay = (p: string) => {
  const n = p.replace(/^\+234/, "0");
  return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
};

export function LoginForm({ adminPhone }: { adminPhone: string }) {
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
      <div className="rounded-lg bg-sand p-3 text-center text-sm text-ink">
        <p className="font-semibold">Forgot your password?</p>
        <p className="mt-1 text-muted">Call or send a message to the Admin, who will give you a new one.</p>
        <p className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
          <a href={`tel:${adminPhone}`} className="font-semibold text-forest underline">Call {adminDisplay(adminPhone)}</a>
          <a href={`https://wa.me/${adminPhone.replace(/^\+/, "")}`} className="font-semibold text-forest underline">WhatsApp</a>
        </p>
      </div>
    </form>
  );
}
