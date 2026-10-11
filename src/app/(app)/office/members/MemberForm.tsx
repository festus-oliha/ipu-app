"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormError, SubmitButton } from "@/components/Field";
import { Notice } from "@/components/ui";
import { TITLES } from "@/lib/memberInput";
import type { MemberFormState } from "./actions";

type Values = Partial<Record<string, string>>;
type Action = (prev: MemberFormState, form: FormData) => Promise<MemberFormState>;

const input =
  "h-12 w-full rounded-lg border border-line bg-ivory px-3 text-base text-ink focus:border-forest aria-[invalid=true]:border-danger";

function F({
  name, label, values, errors, hint, ...rest
}: { name: string; label: string; values: Values; errors?: Record<string, string>; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const error = errors?.[name];
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-semibold">{label}</label>
      <input
        id={name}
        name={name}
        defaultValue={values[name] ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={input}
        {...rest}
      />
      {error ? <p id={`${name}-error`} className="text-sm text-danger">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function MemberForm({ action, initial, mode }: { action: Action; initial: Values; mode: "new" | "edit" }) {
  const [state, formAction, pending] = useActionState<MemberFormState, FormData>(action, {});

  if (mode === "new" && state.saved) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success">
          <p className="font-semibold">{state.saved.fullName} is now member {state.saved.memberNo}.</p>
          {state.saved.tempPassword ? (
            <>
              <p className="mt-2">Their login: their phone number, with this temporary password (shown only once):</p>
              <p className="mt-2 font-mono text-2xl tracking-wider">{state.saved.tempPassword}</p>
            </>
          ) : (
            <p className="mt-2">No phone number yet, so no login. Add the number later under Edit details; the temporary password is shown then.</p>
          )}
          <p className="mt-2">They will be asked to choose their own password the first time they sign in.</p>
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Link href={`/office/members/${state.saved.memberId}`} className="inline-flex h-11 items-center rounded-lg bg-forest px-4 text-sm font-semibold text-ivory">
            Open member
          </Link>
          {/* A new ?after= value re-keys the form on the page, giving an empty form. */}
          <Link href={`/office/members/new?after=${state.saved.memberNo}`} className="inline-flex h-11 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold">
            Add another member
          </Link>
        </div>
      </div>
    );
  }

  const values: Values = state.values ?? initial;
  const errors = state.errors;

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {mode === "edit" && state.saved ? (
        <Notice tone="success">
          Changes saved.
          {state.saved.tempPassword ? (
            <> A login was created with the new phone number. Temporary password (shown only once): <span className="font-mono text-lg font-semibold">{state.saved.tempPassword}</span></>
          ) : null}
        </Notice>
      ) : null}
      {errors && Object.keys(errors).length ? (
        <Notice tone="warning">Please correct the {Object.keys(errors).length === 1 ? "field" : "fields"} marked in red.</Notice>
      ) : null}

      <fieldset className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <legend className="mb-3 font-display text-lg text-forest">Member</legend>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="title" className="text-sm font-semibold">Title</label>
          <select id="title" name="title" defaultValue={values.title ?? ""} className={input}>
            {TITLES.map((t) => <option key={t} value={t}>{t || "—"}</option>)}
          </select>
        </div>
        <F name="fullName" label="Full name" values={values} errors={errors} autoComplete="off" required />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-display text-lg text-forest">Contact</legend>
        <F name="phone" label="Phone number (used to sign in; leave empty if not known yet)" values={values} errors={errors} type="tel" inputMode="tel" placeholder="0803 445 3367" />
        <F name="email" label="Email (optional)" values={values} errors={errors} type="email" />
        <F name="occupation" label="Trade or occupation" values={values} errors={errors} />
        <F name="address" label="Home or shop address" values={values} errors={errors} />
        <F name="emergencyName" label="Emergency contact name" values={values} errors={errors} />
        <F name="emergencyPhone" label="Emergency contact phone" values={values} errors={errors} type="tel" inputMode="tel" />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-display text-lg text-forest">Money</legend>
        <F name="usualMonthly" label="Usual monthly contribution (₦)" values={values} errors={errors} inputMode="decimal" placeholder="10,000" hint="Sets the loan limit: this amount × 12." />
        <F name="yearJoined" label="Year joined" values={values} errors={errors} inputMode="numeric" placeholder="2011" />
        <F name="bankName" label="Bank name (for payouts)" values={values} errors={errors} placeholder="GT Bank" />
        <F name="accountNumber" label="Account number" values={values} errors={errors} inputMode="numeric" maxLength={13} />
      </fieldset>

      {mode === "edit" ? (
        <div className="flex max-w-xs flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-semibold">Status</label>
          <select id="status" name="status" defaultValue={values.status ?? "ACTIVE"} className={input}>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="EXITED">Exited</option>
          </select>
        </div>
      ) : null}

      <FormError message={state.error} />
      <div className="max-w-xs">
        <SubmitButton pending={pending}>{mode === "new" ? "Add member" : "Save changes"}</SubmitButton>
      </div>
    </form>
  );
}
