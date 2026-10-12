import type { Metadata } from "next";
import { ActionForm, type FieldSpec } from "@/components/ActionForm";
import { Card, PageHeader } from "@/components/ui";
import { OFFICER_ROLES, hasRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { officerNames } from "@/lib/ledger";
import { MONTH_NAMES, formatDate, monthKey, monthLabel, todayLagos } from "@/lib/periods";
import { displayPhone } from "@/lib/phone";
import { SETTING_DEFS, firstChangeableMonth, settingsAt } from "@/lib/settings";
import { cancelSetting, saveSettings } from "./actions";

export const metadata: Metadata = { title: "Settings" };

const MONTHS = MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m }));

function show(key: string, value: string) {
  const d = SETTING_DEFS.find((x) => x.key === key)!;
  if (d.kind === "month") return MONTH_NAMES[Number(value) - 1];
  if (d.kind === "phone") return displayPhone(value);
  if (key === "INTEREST_PER_1000") return `₦${value} (${Number(value) / 10}% a month)`;
  return value;
}

/** Union rules: everyone in the office can see them; only the Admin changes them. */
export default async function SettingsPage() {
  const user = await requireRole(...OFFICER_ROLES);
  const admin = hasRole(user, "ADMIN");
  const today = todayLagos();
  const [now, earliest, rows] = await Promise.all([
    settingsAt(),
    firstChangeableMonth(),
    db.setting.findMany({ where: { key: { in: SETTING_DEFS.map((d) => d.key) } }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] }),
  ]);
  const todayDate = new Date(`${today}T00:00:00Z`);
  const upcoming = rows.filter((r) => r.effectiveFrom > todayDate);
  const history = rows.filter((r) => r.effectiveFrom <= todayDate);
  const names = await officerNames(rows.map((r) => r.createdById).filter((x): x is string => Boolean(x)));
  const label = (k: string) => SETTING_DEFS.find((d) => d.key === k)!.label;

  const fromOptions = Array.from({ length: 13 }, (_, i) => new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth() + i, 1)))
    .map((d) => ({ value: monthKey(d), label: `1 ${monthLabel(d)}` }));
  const fields: FieldSpec[] = [
    ...SETTING_DEFS.map((d): FieldSpec => ({
      name: d.key,
      label: d.label,
      hint: d.hint,
      type: d.kind === "month" ? "select" : "text",
      options: d.kind === "month" ? MONTHS : undefined,
      defaultValue: d.kind === "phone" ? displayPhone(now.values[d.key]) : now.values[d.key],
    })),
    { name: "from", label: "The changes start on", type: "select", options: fromOptions, defaultValue: fromOptions[0].value, hint: "Money rules start on the 1st of a month that is not yet closed, so closed months never change. The phone number changes at once." },
    { name: "reason", label: "Reason", placeholder: "e.g. agreed at the general meeting of 5 October", wide: true },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Office" title="Settings" />
      <p className="-mt-3 text-sm text-muted">
        The union&apos;s rules used by the app. {admin ? "Change a value and save; every change goes into the change log." : "Only the Admin can change them."} Interest is always due by the 15th of the next month.
      </p>

      <Card title="Rules in force today">
        <dl className="flex flex-col divide-y divide-line">
          {SETTING_DEFS.map((d) => (
            <div key={d.key} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-sm text-muted">{d.label}</dt>
              <dd className="font-semibold">{show(d.key, now.values[d.key])}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {upcoming.length ? (
        <Card title="Changes waiting to start">
          <ul className="flex flex-col divide-y divide-line">
            {upcoming.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <span><span className="font-semibold">{label(r.key)}</span> becomes <span className="font-semibold">{show(r.key, r.value)}</span> from {formatDate(r.effectiveFrom)}</span>
                {admin ? <ActionForm action={cancelSetting.bind(null, r.id)} submit="Cancel this change" tone="secondary" /> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {admin ? (
        <Card title="Change the rules">
          <ActionForm action={saveSettings} fields={fields} submit="Save changes" />
        </Card>
      ) : null}

      <Card title="Earlier changes">
        {history.length === 0 ? <p className="text-sm text-muted">None yet: the app is using the rules agreed when it was set up.</p> : (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {history.map((r) => (
              <li key={r.id} className="py-2">
                <span className="font-semibold">{label(r.key)}</span>: {show(r.key, r.value)} from {formatDate(r.effectiveFrom)}
                <span className="text-muted">{r.createdById ? ` · by ${names.get(r.createdById) ?? ""}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
