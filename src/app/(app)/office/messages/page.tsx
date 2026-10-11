import type { Metadata } from "next";
import { ActionForm } from "@/components/ActionForm";
import { Card, Notice, PageHeader, Stat } from "@/components/ui";
import { OFFICER_ROLES, hasRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { LIVE } from "@/lib/ledger";
import { emailConfigured, smsProvider } from "@/lib/messaging";
import { formatNaira } from "@/lib/money";
import { currentYear, formatDate } from "@/lib/periods";
import { displayPhone } from "@/lib/phone";
import { retryFailed, runJobsNow, sendNow, testSms } from "./actions";

export const metadata: Metadata = { title: "Messages" };

const STATUS = { QUEUED: "Waiting", SENT: "Sent", FAILED: "Failed" } as const;

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireRole(...OFFICER_ROLES);
  const { show } = await searchParams;
  const year = await currentYear();
  const since = year?.startDate ?? new Date(0);
  const filter = show === "QUEUED" || show === "FAILED" || show === "SENT" ? { status: show as "QUEUED" | "FAILED" | "SENT" } : {};

  const [counts, spend, fees, list] = await Promise.all([
    db.notification.groupBy({ by: ["status"], _count: true }),
    db.notification.aggregate({ where: { channel: "SMS", status: "SENT", sentAt: { gte: since } }, _sum: { costKobo: true }, _count: true }),
    year ? db.ledgerEntry.aggregate({ where: { ...LIVE, type: "MEMBERSHIP_FEE", period: { yearId: year.id } }, _sum: { amountKobo: true } }) : null,
    db.notification.findMany({ where: filter, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const provider = smsProvider();
  const canSend = hasRole(user, "ADMIN", "TREASURER");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Office" title="Messages" />
      {!provider ? (
        <Notice tone="warning">No SMS provider is set up yet, so messages wait here. They are sent automatically once the provider details are added (see README, &ldquo;SMS and email&rdquo;).</Notice>
      ) : provider === "log" ? <Notice>Test mode: messages are marked as sent but not really delivered.</Notice> : null}
      {!emailConfigured() ? <Notice>Email is not set up yet. Guarantor emails and the monthly backup wait until it is.</Notice> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting" value={String(count("QUEUED"))} />
        <Stat label="Failed" value={String(count("FAILED"))} />
        <Stat label="SMS sent this year" value={String(spend._count)} />
        <Stat label="SMS spend this year" value={formatNaira(spend._sum.costKobo ?? 0n, { compact: true })} note={fees ? `Membership fees ${formatNaira(fees._sum.amountKobo ?? 0n, { compact: true })}` : undefined} />
      </div>

      {canSend ? (
        <Card title="Send">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-6">
              <ActionForm action={sendNow} submit="Send waiting messages now" />
              {count("FAILED") ? <ActionForm action={retryFailed} submit="Try failed messages again" tone="secondary" /> : null}
              {hasRole(user, "ADMIN") ? <ActionForm action={runJobsNow} submit="Run today's reminders now" tone="secondary" /> : null}
            </div>
            {hasRole(user, "ADMIN") ? (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-forest">Send a test SMS</summary>
                <div className="mt-3"><ActionForm action={testSms} submit="Send test" fields={[{ name: "phone", label: "Phone number", placeholder: "0803 123 4567" }]} /></div>
              </details>
            ) : null}
          </div>
        </Card>
      ) : null}

      <nav className="flex gap-2 text-sm" aria-label="Filter">
        {[["", "All"], ["QUEUED", "Waiting"], ["FAILED", "Failed"], ["SENT", "Sent"]].map(([v, l]) => (
          <a key={v} href={v ? `?show=${v}` : "?"} aria-current={(show ?? "") === v ? "page" : undefined}
            className={`rounded-lg px-3 py-2 font-semibold ${(show ?? "") === v ? "bg-forest text-ivory" : "border border-line bg-white"}`}>{l}</a>
        ))}
      </nav>
      <Card>
        {list.length === 0 ? <p className="text-sm text-muted">No messages.</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {list.map((n) => (
              <li key={n.id} className="flex flex-col gap-1 py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold">{n.channel === "SMS" ? displayPhone(n.to) : n.to} · {n.channel}</span>
                  <span className={n.status === "FAILED" ? "text-danger" : n.status === "SENT" ? "text-forest" : "text-muted"}>
                    {STATUS[n.status]} · {formatDate(n.sentAt ?? n.createdAt)}
                  </span>
                </div>
                {n.subject ? <p className="font-semibold">{n.subject}</p> : null}
                <p className="whitespace-pre-line text-muted">{n.message}</p>
                {n.error && n.status !== "SENT" ? <p className="text-xs text-danger">{n.error}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
