"use client";

import { useActionState, useState } from "react";
import { FormError, SubmitButton } from "@/components/Field";
import { Notice } from "@/components/ui";
import { recordPayment, type PaymentState } from "../actions";

const input =
  "h-12 w-full rounded-lg border border-line bg-ivory px-3 text-base text-ink focus:border-forest aria-[invalid=true]:border-danger";

type MemberOption = { label: string; usual: string };
type Values = Record<string, string>;

export function PaymentForm({ members, today, preselect }: { members: MemberOption[]; today: string; preselect?: string }) {
  const [state, action, pending] = useActionState<PaymentState, FormData>(recordPayment, {});
  // After a save, keep the date (officers usually enter a batch for one day) and clear the rest.
  const values: Values = state.saved ? { date: state.saved.date } : (state.values ?? { member: preselect ?? "", date: today });

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.saved ? (
        <Notice tone="success">
          <p className="font-semibold">
            Recorded for {state.saved.memberName} ({state.saved.memberNo}), {state.saved.month}:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {state.saved.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
          <p className="mt-2 text-xs">An SMS confirmation has been queued for the member.</p>
        </Notice>
      ) : null}

      {/* Re-mounted after every submit so the fields show exactly `values`. */}
      <Fields key={JSON.stringify(state)} members={members} today={today} values={values} errors={state.errors ?? {}} />

      <FormError message={state.error} />
      <div className="max-w-xs">
        <SubmitButton pending={pending}>Record payment</SubmitButton>
      </div>
    </form>
  );
}

function Fields({ members, today, values, errors }: { members: MemberOption[]; today: string; values: Values; errors: Record<string, string> }) {
  const [member, setMember] = useState(values.member ?? "");
  const usual = members.find((m) => m.label === member)?.usual;

  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-semibold">{label}</label>
      <input
        id={name}
        name={name}
        defaultValue={values[name] ?? ""}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${name}-error` : undefined}
        className={input}
        {...props}
      />
      {errors[name] ? <p id={`${name}-error`} className="text-sm text-danger">{errors[name]}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="member" className="text-sm font-semibold">Member</label>
        <input
          id="member"
          name="member"
          list="member-list"
          value={member}
          onChange={(e) => setMember(e.target.value)}
          placeholder="Type a name or IPU number"
          autoComplete="off"
          aria-invalid={errors.member ? true : undefined}
          aria-describedby={errors.member ? "member-error" : "member-hint"}
          className={input}
        />
        <datalist id="member-list">
          {members.map((m) => <option key={m.label} value={m.label} />)}
        </datalist>
        {errors.member ? (
          <p id="member-error" className="text-sm text-danger">{errors.member}</p>
        ) : (
          <p id="member-hint" className="text-xs text-muted">{usual ? `Usual monthly contribution: ${usual}` : "Start typing, then pick from the list."}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {field("date", "Date paid into the bank", { type: "date", max: today })}
        {field("bankRef", "Bank or transfer reference (optional)", { autoComplete: "off" })}
        {field("contribution", "Contribution (₦)", { inputMode: "decimal", placeholder: "10,000" })}
        {field("membershipFee", "Membership fee (₦)", { inputMode: "decimal", placeholder: "0" }, "Only when a new member pays the joining fee.")}
      </div>
      {field("note", "Note (optional)", { autoComplete: "off" })}

      <Notice>Loan interest and loan repayments will be recorded here once loans are added (phase 3).</Notice>
    </>
  );
}
