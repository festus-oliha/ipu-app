"use client";

import { startTransition, useActionState, useState } from "react";
import { FormError, SubmitButton } from "@/components/Field";
import { uploadReceipt, type UploadState } from "../actions";

const input =
  "h-12 w-full rounded-lg border border-line bg-ivory px-3 text-base text-ink focus:border-forest aria-[invalid=true]:border-danger";

/** Phone photos are often 3–8 MB; shrink them to a clear 1,600-pixel JPEG before sending. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 600_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ? new File([blob], "receipt.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file; // the server explains if it is still too large
  }
}

export function ReceiptForm({ today, hasLoan }: { today: string; hasLoan: boolean }) {
  const [state, formAction, pending] = useActionState<UploadState, FormData>(uploadReceipt, {});
  const [preparing, setPreparing] = useState(false);
  const errors = state.errors ?? {};
  const values = state.values ?? {};
  const err = (name: string) => (errors[name] ? <p id={`${name}-error`} className="text-sm text-danger">{errors[name]}</p> : null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const file = data.get("file");
    if (file instanceof File && file.size > 0) {
      setPreparing(true);
      data.set("file", await shrink(file));
      setPreparing(false);
    }
    startTransition(() => formAction(data));
  }

  const money = (name: string, label: string, hint?: string) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-semibold">{label}</label>
      <input id={name} name={name} inputMode="decimal" defaultValue={values[name] ?? ""} aria-invalid={errors[name] ? true : undefined} className={input} />
      {err(name) ?? (hint ? <p className="text-xs text-muted">{hint}</p> : null)}
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="file" className="text-sm font-semibold">Photo or PDF of the bank receipt</label>
        <input id="file" name="file" type="file" accept="image/*,application/pdf" aria-invalid={errors.file ? true : undefined}
          className="rounded-lg border border-line bg-ivory p-3 text-base file:mr-3 file:rounded-md file:border-0 file:bg-forest file:px-3 file:py-2 file:font-semibold file:text-ivory" />
        {err("file") ?? <p className="text-xs text-muted">Make sure the amount, date and account number can be read.</p>}
      </div>
      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <label htmlFor="date" className="text-sm font-semibold">Date on the receipt</label>
        <input id="date" name="date" type="date" max={today} defaultValue={values.date ?? today} aria-invalid={errors.date ? true : undefined} className={input} />
        {err("date")}
      </div>
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold">What is the money for? (₦)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {money("contribution", "Monthly contribution")}
          {money("membershipFee", "Membership fee")}
          {hasLoan ? money("interest", "Loan interest") : null}
          {hasLoan ? money("repayment", "Loan repayment", "Money paid to reduce the loan itself") : null}
        </div>
      </fieldset>
      <FormError message={state.error} />
      <SubmitButton pending={pending || preparing}>Send receipt for checking</SubmitButton>
    </form>
  );
}
