"use client";

import { useActionState } from "react";
import { FormError } from "./Field";
import { Notice, buttonStyles } from "./ui";

export type FormResult = { errors?: Record<string, string>; error?: string; done?: string };

export type FieldSpec = {
  name: string;
  label: string;
  type?: "text" | "money" | "date" | "select" | "hidden";
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  defaultValue?: string;
  max?: string;
  wide?: boolean;
  /** id of a <datalist> with suggestions */
  list?: string;
};

const input = "h-11 w-full rounded-lg border border-line bg-ivory px-3 text-base aria-[invalid=true]:border-danger";

/**
 * A small form for one server action: fields laid out two per row on wider
 * screens, field errors under each box, a success notice that resets the form.
 * Extra buttons (e.g. approve / decline) can be passed as `buttons`.
 */
export function ActionForm({
  action,
  fields = [],
  submit,
  tone = "primary",
  buttons,
  intro,
}: {
  action: (prev: FormResult, form: FormData) => Promise<FormResult>;
  fields?: FieldSpec[];
  submit?: string;
  tone?: "primary" | "secondary" | "danger";
  buttons?: { name: string; value: string; label: string; tone: "primary" | "secondary" | "danger" }[];
  intro?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(action, {});
  const e = state.errors ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-3" key={state.done}>
      {state.done ? <Notice tone="success">{state.done}</Notice> : null}
      {intro}
      {fields.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) =>
            f.type === "hidden" ? (
              <input key={f.name} type="hidden" name={f.name} value={f.defaultValue} />
            ) : (
              <label key={f.name} className={`flex flex-col gap-1 text-sm font-semibold ${f.wide ? "sm:col-span-2" : ""}`}>
                {f.label}
                {f.type === "select" ? (
                  <select name={f.name} defaultValue={f.defaultValue ?? ""} aria-invalid={e[f.name] ? true : undefined} className={input}>
                    <option value="" disabled>Choose…</option>
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input
                    name={f.name}
                    type={f.type === "date" ? "date" : "text"}
                    inputMode={f.type === "money" ? "decimal" : undefined}
                    placeholder={f.placeholder}
                    defaultValue={f.defaultValue}
                    max={f.max}
                    list={f.list}
                    autoComplete="off"
                    aria-invalid={e[f.name] ? true : undefined}
                    className={input}
                  />
                )}
                {e[f.name] ? <span className="font-normal text-danger">{e[f.name]}</span> : f.hint ? <span className="text-xs font-normal text-muted">{f.hint}</span> : null}
              </label>
            ),
          )}
        </div>
      ) : null}
      <FormError message={state.error} />
      <div className="flex flex-wrap gap-2">
        {submit ? (
          <button type="submit" disabled={pending} className={buttonStyles[tone]}>{pending ? "Please wait…" : submit}</button>
        ) : null}
        {buttons?.map((b) => (
          <button key={b.value} type="submit" name={b.name} value={b.value} disabled={pending} className={buttonStyles[b.tone]}>{b.label}</button>
        ))}
      </div>
    </form>
  );
}
