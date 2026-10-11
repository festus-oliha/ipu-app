"use client";

import { useActionState } from "react";
import { FormError } from "@/components/Field";
import { Notice, buttonStyles } from "@/components/ui";
import type { ResetState, RolesState } from "../actions";

export function ResetPasswordForm({ action, hasLogin }: { action: (prev: ResetState) => Promise<ResetState>; hasLogin: boolean }) {
  const [state, formAction, pending] = useActionState<ResetState>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.tempPassword ? (
        <Notice tone="success">
          <p>New temporary password (shown only once). Give it to the member; they will choose their own when they sign in:</p>
          <p className="mt-2 font-mono text-2xl tracking-wider">{state.tempPassword}</p>
        </Notice>
      ) : (
        <p className="text-sm text-muted">
          {hasLogin
            ? "Use this if the member forgot their password or is locked out."
            : "This member cannot sign in yet. Create a login with a temporary password."}
        </p>
      )}
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${buttonStyles.secondary} self-start`}>
        {pending ? "Please wait…" : hasLogin ? "Reset password" : "Create login"}
      </button>
    </form>
  );
}

const ROLE_OPTIONS = [
  { role: "PRESIDENT", label: "President", help: "Approves loans first; signs off months" },
  { role: "TREASURER", label: "Treasurer", help: "Records payments; approves and pays out loans" },
  { role: "SECRETARY", label: "Secretary", help: "Manages members; records payments; co-signs months" },
  { role: "AUDITOR", label: "Auditor", help: "Can see everything, change nothing" },
  { role: "ADMIN", label: "Admin", help: "Full control, including settings and roles" },
];

export function RolesForm({
  action,
  current,
}: {
  action: (prev: RolesState, form: FormData) => Promise<RolesState>;
  current: string[];
}) {
  const [state, formAction, pending] = useActionState<RolesState, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Office roles</legend>
        {ROLE_OPTIONS.map((o) => (
          <label key={o.role} className="flex min-h-11 items-start gap-3 rounded-lg border border-line p-3 hover:bg-ivory">
            <input type="checkbox" name={o.role} defaultChecked={current.includes(o.role)} className="mt-1 size-5 accent-forest" />
            <span>
              <span className="block text-sm font-semibold">{o.label}</span>
              <span className="block text-xs text-muted">{o.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {state.ok ? <Notice tone="success">Roles saved.</Notice> : null}
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${buttonStyles.secondary} self-start`}>
        {pending ? "Saving…" : "Save roles"}
      </button>
    </form>
  );
}
