"use server";

import { revalidatePath } from "next/cache";
import type { FormResult } from "@/components/ActionForm";
import { audit } from "@/lib/audit";
import { actionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { monthLabel, monthStart, todayLagos } from "@/lib/periods";
import { normalizePhone } from "@/lib/phone";
import { SETTING_DEFS, firstChangeableMonth, settingsAt } from "@/lib/settings";

/** Admin changes union rules. Money rules start on the 1st of a month that is not closed; every change is in the change log. */
export async function saveSettings(_prev: FormResult, form: FormData): Promise<FormResult> {
  const user = await actionUser("ADMIN");
  const from = monthStart(String(form.get("from") ?? ""));
  const earliest = await firstChangeableMonth();
  if (!from) return { errors: { from: "Choose the month the change starts." } };
  if (from < earliest) return { errors: { from: `Months up to ${monthLabel(new Date(earliest.getTime() - 864e5))} are closed or past; choose ${monthLabel(earliest)} or later.` } };
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 5) return { errors: { reason: "Say why (e.g. agreed at the general meeting of 5 October)." } };

  const current = await settingsAt(from);
  const errors: Record<string, string> = {};
  const changes: { key: string; old: string; value: string; effectiveFrom: Date }[] = [];
  for (const d of SETTING_DEFS) {
    const raw = String(form.get(d.key) ?? "").trim();
    if (raw === "") continue;
    let value = raw;
    if (d.kind === "phone") {
      const p = normalizePhone(raw);
      if (!p) { errors[d.key] = "Enter a Nigerian phone number, e.g. 0907 672 9480."; continue; }
      value = p;
    } else {
      const n = Number(raw.replace(/,/g, ""));
      const min = d.kind === "month" ? 1 : d.min!;
      const max = d.kind === "month" ? 12 : d.max!;
      if (!Number.isInteger(n) || n < min || n > max) { errors[d.key] = `Enter a whole number from ${min} to ${max}.`; continue; }
      value = String(n);
    }
    if (value !== current.values[d.key]) changes.push({ key: d.key, old: current.values[d.key], value, effectiveFrom: d.fromMonth ? from : new Date(`${todayLagos()}T00:00:00Z`) });
  }
  if (Object.keys(errors).length) return { errors };
  if (!changes.length) return { done: "Nothing changed." };

  await db.$transaction(async (tx) => {
    for (const c of changes) {
      const row = await tx.setting.upsert({
        where: { key_effectiveFrom: { key: c.key, effectiveFrom: c.effectiveFrom } },
        update: { value: c.value, createdById: user.id },
        create: { key: c.key, value: c.value, effectiveFrom: c.effectiveFrom, createdById: user.id },
      });
      await audit({ userId: user.id, action: "settings.change", table: "Setting", recordId: row.id, oldValue: { [c.key]: c.old }, newValue: { [c.key]: c.value, from: c.effectiveFrom.toISOString().slice(0, 10) }, reason }, tx);
    }
  });
  revalidatePath("/", "layout");
  const label = (k: string) => SETTING_DEFS.find((d) => d.key === k)!.label;
  return { done: `Saved: ${changes.map((c) => label(c.key)).join("; ")}.` };
}

/** Cancel a change that has not started yet. */
export async function cancelSetting(settingId: string): Promise<FormResult> {
  const user = await actionUser("ADMIN");
  const row = await db.setting.findUnique({ where: { id: settingId } });
  if (!row || !SETTING_DEFS.some((d) => d.key === row.key)) return { error: "This change no longer exists." };
  if (row.effectiveFrom <= new Date(`${todayLagos()}T00:00:00Z`)) return { error: "This change has already started; make a new change instead." };
  await db.$transaction(async (tx) => {
    await tx.setting.delete({ where: { id: row.id } });
    await audit({ userId: user.id, action: "settings.cancel", table: "Setting", recordId: row.id, oldValue: { [row.key]: row.value, from: row.effectiveFrom.toISOString().slice(0, 10) } }, tx);
  });
  revalidatePath("/", "layout");
  return { done: "Change cancelled." };
}
