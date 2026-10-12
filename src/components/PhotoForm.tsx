"use client";

import { useActionState } from "react";
import type { FormResult } from "./ActionForm";
import { FormError } from "./Field";
import { MemberPhoto } from "./MemberPhoto";
import { Notice, buttonStyles } from "./ui";

/** Choose and save a passport photo; shows the current one. */
export function PhotoForm({ action, memberId, name, version }: { action: (prev: FormResult, form: FormData) => Promise<FormResult>; memberId: string; name: string; version: string | null }) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
      <MemberPhoto memberId={memberId} name={name} version={version} className="h-32 w-26 shrink-0 rounded-lg" />
      <div className="flex flex-1 flex-col gap-2">
        {state.done ? <Notice tone="success">{state.done}</Notice> : null}
        <p className="text-sm text-muted">A clear passport-style photo of the face, for the ID card. JPG, PNG or WebP, up to 4 MB.</p>
        <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" className="text-sm file:mr-3 file:h-11 file:rounded-lg file:border file:border-line file:bg-white file:px-4 file:font-semibold" />
        {state.errors?.photo ? <p className="text-sm font-medium text-danger">{state.errors.photo}</p> : null}
        <FormError message={state.error} />
        <div><button type="submit" disabled={pending} className={buttonStyles.secondary}>{pending ? "Uploading…" : version ? "Replace photo" : "Save photo"}</button></div>
      </div>
    </form>
  );
}
