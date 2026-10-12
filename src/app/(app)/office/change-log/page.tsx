import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { Card, PageHeader, buttonStyles } from "@/components/ui";
import { LOG_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseDateInput } from "@/lib/periods";

export const metadata: Metadata = { title: "Change log" };

const PAGE_SIZE = 50;

/** Plain words for each kind of change. */
const ACTIONS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.failed": "Wrong password tried",
  "seed.admin": "Admin account created",
  "auth.password_changed": "Changed own password",
  "bank.opening": "Set opening bank balance",
  "exit.approve": "Approved exit",
  "exit.pay": "Paid exit",
  "exit.reject": "Rejected exit",
  "exit.request": "Asked to leave",
  "export.backup": "Downloaded full records",
  "export.year": "Downloaded year workbook",
  "investment.place": "Placed investment",
  "investment.propose": "Proposed investment",
  "investment.return": "Recorded investment return",
  "investment.decide": "Decided on investment",
  "jobs.run_now": "Ran reminders now",
  "legal.refer": "Referred to lawyer",
  "legal.update": "Updated legal case",
  "loan.default": "Marked loan defaulted",
  "loan.disburse": "Paid out loan",
  "loan.recover": "Recovered loan from savings",
  "loan.request": "Requested loan",
  "member.create": "Added member",
  "member.password_reset": "Reset member's password",
  "member.roles": "Changed member's roles",
  "member.update": "Updated member",
  "member.self_update": "Updated own details",
  "member.photo": "Changed photo",
  "notice.contribution": "Contribution notice sent",
  "settings.change": "Changed a rule",
  "settings.cancel": "Cancelled a rule change",
  "messages.retry": "Retried messages",
  "messages.test": "Sent test message",
  "month.close": "Closed month",
  "month.reopen": "Reopened month",
  "payment.record": "Recorded payment",
  "payment.reverse": "Reversed entry",
  "receipt.reject": "Rejected receipt",
  "receipt.upload": "Uploaded receipt",
  "settle.deduct": "Year-end deduction",
  "year.close": "Closed year",
  "year.debtor_plan": "Set debtor's plan",
  "year.dividend_rate": "Set dividend rate",
  "year.open": "Opened year",
  "year.payout": "Paid year-end payout",
};

const AREAS: { value: string; label: string }[] = [
  { value: "payment", label: "Payments" },
  { value: "loan", label: "Loans" },
  { value: "member", label: "Members" },
  { value: "month", label: "Months" },
  { value: "year", label: "Year end" },
  { value: "exit", label: "Exits" },
  { value: "receipt", label: "Receipts" },
  { value: "investment", label: "Investments" },
  { value: "bank", label: "Bank" },
  { value: "notice", label: "Notices" },
  { value: "settings", label: "Settings" },
  { value: "auth", label: "Sign-in and passwords" },
  { value: "export", label: "Downloads" },
  { value: "job", label: "Automatic jobs" },
];

const label = (action: string) => ACTIONS[action] ?? (action.startsWith("job.") ? `Automatic: ${action.slice(4).replace(/[._]/g, " ")}` : action.replace(/[._]/g, " "));

/** Long ids and bigint kobo values made readable. */
function show(value: Prisma.JsonValue | null): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const skip = new Set(["id", "createdAt", "updatedAt", "passwordHash"]);
  return Object.entries(value)
    .filter(([k, v]) => !skip.has(k) && v !== null && v !== "")
    .map(([k, v]) => {
      const text = /Kobo$/.test(k) && typeof v === "string" && /^-?\d+$/.test(v)
        ? `₦${(Number(v) / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`
        : typeof v === "object" ? JSON.stringify(v) : String(v);
      return `${k.replace(/Kobo$/, "")}: ${text}`;
    })
    .join(" · ");
}

/** When both sides are records, keep only the fields that changed. */
function changedOnly(a: Prisma.JsonValue | null, b: Prisma.JsonValue | null): [Prisma.JsonValue | null, Prisma.JsonValue | null] {
  const isObj = (v: unknown): v is Record<string, Prisma.JsonValue> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObj(a) || !isObj(b)) return [a, b];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
  return [Object.fromEntries(keys.map((k) => [k, a[k] ?? "(empty)"])), Object.fromEntries(keys.map((k) => [k, b[k] ?? "(empty)"]))];
}

type Search = { who?: string; area?: string; member?: string; from?: string; to?: string; page?: string; jobs?: string };

export default async function ChangeLogPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireRole(...LOG_ROLES);
  const q = await searchParams;
  const page = Math.max(1, Number(q.page) || 1);
  const from = q.from ? parseDateInput(q.from) : null;
  const toDay = q.to ? parseDateInput(q.to) : null;
  const to = toDay ? new Date(toDay.getTime() + 86_400_000) : null;

  const [officers, members] = await Promise.all([
    db.user.findMany({ where: { roles: { some: { role: { not: "MEMBER" } } } }, select: { id: true, phone: true, member: { select: { fullName: true } } } }),
    db.member.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true, title: true, memberNo: true, userId: true } }),
  ]);

  // A member's changes: their record, their own actions, and ledger rows, loans, receipts and exits about them.
  let memberRecords: string[] | null = null;
  const chosen = q.member ? members.find((m) => m.id === q.member) : null;
  if (chosen) {
    const [entries, loans, receipts, exits] = await Promise.all([
      db.ledgerEntry.findMany({ where: { memberId: chosen.id }, select: { id: true } }),
      db.loan.findMany({ where: { OR: [{ borrowerId: chosen.id }, { guarantorId: chosen.id }] }, select: { id: true } }),
      db.receipt.findMany({ where: { memberId: chosen.id }, select: { id: true } }),
      db.exit.findMany({ where: { memberId: chosen.id }, select: { id: true } }),
    ]);
    memberRecords = [chosen.id, ...(chosen.userId ? [chosen.userId] : []), ...entries, ...loans, ...receipts, ...exits].map((x) => (typeof x === "string" ? x : x.id));
  }

  const where: Prisma.AuditLogWhereInput = {
    ...(q.who ? { userId: q.who } : {}),
    ...(q.area === "job" ? { action: { startsWith: "job." } } : q.area ? { action: { startsWith: `${q.area}.` } } : {}),
    ...(!q.area && q.jobs !== "1" ? { NOT: [{ action: { startsWith: "job." } }, { action: "auth.login" }, { action: "auth.failed" }] } : {}),
    ...(memberRecords ? { recordId: { in: memberRecords } } : {}),
    ...(from || to ? { at: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
  };

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { at: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.auditLog.count({ where }),
  ]);

  // Names for whoever made each change, and for the member each change is about.
  const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => Boolean(x)))];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, phone: true, member: { select: { fullName: true } } } });
  const who = new Map(users.map((u) => [u.id, u.member?.fullName ?? u.phone]));
  const memberIds = new Set(members.map((m) => m.id));
  const entryIds = rows.filter((r) => r.table === "LedgerEntry").map((r) => r.recordId);
  const loanIds = rows.filter((r) => r.table === "Loan").map((r) => r.recordId);
  const [entries, loans] = await Promise.all([
    db.ledgerEntry.findMany({ where: { id: { in: entryIds } }, select: { id: true, memberId: true } }),
    db.loan.findMany({ where: { id: { in: loanIds } }, select: { id: true, borrowerId: true } }),
  ]);
  const aboutId = new Map<string, string | null>([...entries.map((e) => [e.id, e.memberId] as const), ...loans.map((l) => [l.id, l.borrowerId] as const)]);
  const byId = new Map(members.map((m) => [m.id, m]));
  const byUser = new Map(members.filter((m) => m.userId).map((m) => [m.userId!, m]));
  const about = (r: (typeof rows)[number]) => {
    const id = r.table === "Member" && memberIds.has(r.recordId) ? r.recordId : aboutId.get(r.recordId);
    const m = id ? byId.get(id) : r.table === "User" ? byUser.get(r.recordId) : undefined;
    return m ? [m.title, m.fullName].filter(Boolean).join(" ") : null;
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => {
    const s = new URLSearchParams(Object.entries({ ...q, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `/office/change-log?${s}`;
  };
  const input = "h-11 w-full rounded-lg border border-line bg-white px-3 text-sm";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Office" title="Change log" />
      <p className="-mt-3 text-sm text-muted">Every change made in the app: who, when, what it was before and after. Nothing here can be edited or deleted.</p>

      <Card>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" action="/office/change-log">
          <label className="flex flex-col gap-1 text-sm font-semibold">Done by
            <select name="who" defaultValue={q.who ?? ""} className={input}>
              <option value="">Anyone</option>
              {officers.map((o) => <option key={o.id} value={o.id}>{o.member?.fullName ?? o.phone}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">About member
            <select name="member" defaultValue={q.member ?? ""} className={input}>
              <option value="">Any member</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.fullName} ({m.memberNo})</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Kind of change
            <select name="area" defaultValue={q.area ?? ""} className={input}>
              <option value="">All changes</option>
              {AREAS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">From
            <input type="date" name="from" defaultValue={q.from ?? ""} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">To
            <input type="date" name="to" defaultValue={q.to ?? ""} className={input} />
          </label>
          <label className="flex items-center gap-2 self-end pb-3 text-sm">
            <input type="checkbox" name="jobs" value="1" defaultChecked={q.jobs === "1"} className="size-5" />
            Include sign-ins and automatic jobs
          </label>
          <div className="flex gap-3 sm:col-span-2 lg:col-span-3">
            <button type="submit" className={buttonStyles.primary}>Show</button>
            <Link href="/office/change-log" className={buttonStyles.secondary}>Clear</Link>
          </div>
        </form>
      </Card>

      <p className="text-sm text-muted">{total === 0 ? "No changes match." : `${total.toLocaleString("en-NG")} change${total === 1 ? "" : "s"}${pages > 1 ? ` · page ${page} of ${pages}` : ""}`}</p>

      {rows.length ? (
        <ol className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
          {rows.map((r) => {
            const [oldV, newV] = changedOnly(r.oldValue, r.newValue);
            const before = show(oldV);
            const after = show(newV);
            const subject = about(r);
            return (
              <li key={r.id} className="flex flex-col gap-1 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-forest">
                    {label(r.action)}
                    {subject ? <span className="font-normal text-ink"> · {subject}</span> : null}
                  </p>
                  <time className="text-xs text-muted tabular-nums" dateTime={r.at.toISOString()}>
                    {r.at.toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </time>
                </div>
                <p className="text-sm text-muted">By {r.userId ? who.get(r.userId) ?? "a removed user" : "the app (automatic)"}</p>
                {r.reason ? <p className="text-sm"><span className="font-semibold">Reason:</span> {r.reason}</p> : null}
                {before || after ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-forest">Details</summary>
                    <dl className="mt-2 grid gap-1 break-words">
                      {before ? <><dt className="font-semibold">Before</dt><dd className="text-muted">{before}</dd></> : null}
                      {after ? <><dt className="font-semibold">After</dt><dd className="text-muted">{after}</dd></> : null}
                    </dl>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {pages > 1 ? (
        <nav className="flex items-center justify-between gap-3">
          {page > 1 ? <Link href={link(page - 1)} className={buttonStyles.secondary}>← Newer</Link> : <span />}
          {page < pages ? <Link href={link(page + 1)} className={buttonStyles.secondary}>Older →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
