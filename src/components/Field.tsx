/** Labelled input sized for phones (48px tall, 16px text so iOS does not zoom). */
export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement> & { name: string }) {
  const id = input.id ?? input.name;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        className="h-12 rounded-lg border border-line bg-ivory px-3 text-base text-ink placeholder:text-muted/70 focus:border-forest"
        {...input}
      />
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-12 w-full rounded-lg bg-forest text-base font-semibold text-ivory transition hover:bg-forest-dark disabled:opacity-60"
    >
      {pending ? "Please wait…" : children}
    </button>
  );
}

export function FormError({ message }: { message?: string }) {
  return (
    <p role="alert" aria-live="polite" className="min-h-5 text-sm font-medium text-danger">
      {message ?? ""}
    </p>
  );
}
