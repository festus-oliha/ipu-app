import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Card, PageHeader, Stat } from "@/components/ui";
import { OFFICER_ROLES, PAYMENT_ROLES, hasRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { owedOf, recoveryPlan } from "@/lib/debtors";
import { officerNames } from "@/lib/ledger";
import { positionsThrough } from "@/lib/loans";
import { formatNaira } from "@/lib/money";
import { formatDate, todayLagos } from "@/lib/periods";
import { displayPhone } from "@/lib/phone";
import { declareDefault, logContact, recoverFromSavings, referToLegal, sendReminder, updateLegal } from "./actions";

export const metadata: Metadata = { title: "Debtors" };

const FILTERS = [["", "Everyone owing"], ["interest", "Interest unpaid"], ["default", "In default"], ["yearend", "Year-end debtors"], ["legal", "Legal"]] as const;
const CHANNELS = [{ value: "CALL", label: "Phone call" }, { value: "SMS", label: "SMS / WhatsApp" }, { value: "IN_APP", label: "Visit / in person" }, { value: "EMAIL", label: "Email" }];
const LEGAL = ["Referred", "Letter sent", "In court", "Settled", "Closed"].map((s) => ({ value: s, label: s }));

export default async function DebtorsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireRole(...OFFICER_ROLES);
  const { show = "" } = await searchParams;
  const positions = await positionsThrough(new Date(Date.UTC(2100, 0, 1)));
  const ids = [...positions].filter(([, p]) => p.principal > 0n || p.interestOwed > 0n).map(([id]) => id);
  const members = await db.member.findMany({
    where: { id: { in: ids }, status: { not: "EXITED" } },
    orderBy: { memberNo: "asc" },
    include: {
      loans: { where: { status: { in: ["DISBURSED", "DEFAULTED"] } }, include: { guarantor: true }, orderBy: { disbursedOn: "desc" }, take: 1 },
      contactLogs: { orderBy: { at: "desc" }, take: 3 },
      legalReferrals: { orderBy: { referredOn: "desc" }, take: 1 },
      settlements: { where: { result: "DEBTOR" }, include: { year: true }, orderBy: { yearId: "desc" }, take: 1 },
    },
  });
  const rows = members.map((m) => ({ m, p: positions.get(m.id)!, loan: m.loans[0], legal: m.legalReferrals[0], debtor: m.settlements[0] }));
  const shown = rows.filter(({ p, loan, legal, debtor }) =>
    show === "interest" ? p.interestOwed > 0n : show === "default" ? loan?.status === "DEFAULTED" : show === "yearend" ? Boolean(debtor) : show === "legal" ? legal && legal.status !== "Closed" : true,
  );
  const plans = new Map(await Promise.all(rows.filter((r) => r.loan?.status === "DEFAULTED").map(async (r) => [r.loan!.id, await recoveryPlan(r.loan!.id)] as const)));
  const names = await officerNames(rows.flatMap((r) => r.m.contactLogs.map((c) => c.byId)));
  const now = new Date(`${todayLagos()}T00:00:00Z`);

  const total = rows.reduce((t, r) => t + owedOf(r.p), 0n);
  const interest = rows.reduce((t, r) => t + (r.p.interestOwed > 0n ? r.p.interestOwed : 0n), 0n);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Office" title="Debtors" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Members owing" value={String(rows.length)} />
        <Stat label="Total owed" value={formatNaira(total, { compact: true })} />
        <Stat label="Interest unpaid" value={formatNaira(interest, { compact: true })} note={`${rows.filter((r) => r.p.interestOwed > 0n).length} members`} />
        <Stat label="In default / legal" value={`${rows.filter((r) => r.loan?.status === "DEFAULTED").length} / ${rows.filter((r) => r.legal && r.legal.status !== "Closed").length}`} />
      </div>
      <nav aria-label="Filter" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {FILTERS.map(([v, l]) => (
          <Link key={v} href={v ? `?show=${v}` : "?"} aria-current={show === v ? "page" : undefined}
            className={`flex h-10 shrink-0 items-center rounded-lg px-3 text-sm font-semibold ${show === v ? "bg-forest text-ivory" : "border border-line bg-white"}`}>{l}</Link>
        ))}
      </nav>

      {shown.length === 0 ? <Card><p className="text-sm text-muted">Nobody in this list.</p></Card> : null}
      {shown.map(({ m, p, loan, legal, debtor }) => {
        const plan = loan ? plans.get(loan.id) : null;
        const own = m.userId === user.id;
        return (
          <Card key={m.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Link href={`/office/members/${m.id}`} className="font-display text-xl text-forest">{[m.title, m.fullName].filter(Boolean).join(" ")}</Link>
                <p className="text-sm text-muted">{m.memberNo} · {displayPhone(m.phone)}{loan ? ` · guarantor ${loan.guarantor.fullName}` : ""}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
                {loan?.status === "DEFAULTED" ? <span className="rounded-full bg-danger/10 px-2.5 py-1 text-danger">In default</span> : null}
                {debtor ? <span className="rounded-full bg-gold/15 px-2.5 py-1 text-gold-dark">Year-end debtor {debtor.year.label}{debtor.debtorPlan === "PAY_UP" && debtor.debtorDueOn ? `, pay by ${formatDate(debtor.debtorDueOn)}${debtor.debtorDueOn < now ? " (overdue)" : ""}` : ", carried over"}</span> : null}
                {legal && legal.status !== "Closed" ? <span className="rounded-full bg-ink/10 px-2.5 py-1">Legal: {legal.status}</span> : null}
              </div>
            </div>
            <p className="mt-3 text-sm">
              Loan <span className="font-semibold">{formatNaira(p.principal)}</span>
              {p.interestOwed > 0n ? <> · interest unpaid <span className="font-semibold text-danger">{formatNaira(p.interestOwed)}</span></> : null}
              {" "}· total <span className="font-semibold">{formatNaira(owedOf(p))}</span>
            </p>
            {m.contactLogs.length ? (
              <ul className="mt-2 text-xs text-muted">
                {m.contactLogs.map((c) => <li key={c.id}>{formatDate(c.at)} · {c.channel === "IN_APP" ? "In person" : c.channel.toLowerCase()} · {c.outcome}{c.promisedOn ? ` · promised ${formatDate(c.promisedOn)}` : ""} · {names.get(c.byId)}</li>)}
              </ul>
            ) : null}

            {own ? <p className="mt-3 text-sm text-muted">This is your own account; another officer handles it.</p> : (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold text-forest">Actions</summary>
                <div className="mt-3 flex flex-col gap-6">
                  {hasRole(user, ...PAYMENT_ROLES) ? (
                    <>
                      <ActionForm action={sendReminder.bind(null, m.id)} submit="Send reminder SMS" tone="secondary" />
                      <ActionForm action={logContact.bind(null, m.id)} submit="Record contact" tone="secondary" fields={[
                        { name: "channel", label: "How", type: "select", options: CHANNELS },
                        { name: "promisedOn", label: "Promised to pay by (optional)", type: "date" },
                        { name: "outcome", label: "What was said or agreed", wide: true },
                      ]} />
                    </>
                  ) : null}
                  {loan?.status === "DISBURSED" && hasRole(user, "PRESIDENT", "TREASURER") ? (
                    <ActionForm action={declareDefault.bind(null, loan.id)} submit="Declare loan in default" tone="danger"
                      intro={<p className="text-sm text-muted">Borrower and guarantor are told at once. After 7 days the Treasurer can take what is owed from the borrower&apos;s savings, then the guarantor&apos;s.</p>}
                      fields={[{ name: "reason", label: "Reason (months unpaid, contact attempts)", wide: true }]} />
                  ) : null}
                  {loan?.status === "DEFAULTED" && plan ? (
                    <div className="rounded-lg border border-line bg-sand p-4 text-sm">
                      <p className="font-semibold">Recovery from savings{plan.allowedFrom ? `, allowed from ${formatDate(plan.allowedFrom)}` : ""}</p>
                      <p>From {m.fullName}&apos;s savings: {formatNaira(plan.fromBorrower)} · from guarantor {loan.guarantor.fullName}: {formatNaira(plan.fromGuarantor)}{plan.stillOwed ? ` · still owed after: ${formatNaira(plan.stillOwed)}` : ""}</p>
                      {hasRole(user, "TREASURER") ? (
                        <div className="mt-3">
                          <ActionForm action={recoverFromSavings.bind(null, loan.id)} submit="Take from savings now" tone="danger"
                            fields={[{ name: "confirm", label: "Type yes to confirm", placeholder: "yes" }]} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {hasRole(user, "ADMIN", "PRESIDENT") ? (
                    legal && legal.status !== "Closed" ? (
                      <ActionForm action={updateLegal.bind(null, legal.id)} submit="Update legal case" tone="secondary"
                        intro={legal.notes ? <p className="whitespace-pre-line text-xs text-muted">{legal.notes}</p> : null}
                        fields={[{ name: "status", label: "Status", type: "select", options: LEGAL, defaultValue: legal.status }, { name: "note", label: "Note" }]} />
                    ) : (
                      <ActionForm action={referToLegal.bind(null, m.id)} submit="Refer for legal action" tone="danger" fields={[{ name: "notes", label: "Case summary for the lawyer", wide: true }]} />
                    )
                  ) : null}
                </div>
              </details>
            )}
          </Card>
        );
      })}
    </div>
  );
}
