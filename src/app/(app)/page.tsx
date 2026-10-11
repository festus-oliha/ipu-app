import { PaymentHistory } from "@/components/PaymentHistory";
import { Card, LinkButton, Notice, Stat } from "@/components/ui";
import { OFFICER_ROLES, PAYMENT_ROLES, hasRole, requireUser } from "@/lib/auth";
import { memberYearTotals } from "@/lib/ledger";
import { formatNaira } from "@/lib/money";
import { currentYear } from "@/lib/periods";
import { displayPhone } from "@/lib/phone";
import { DEFAULT_RULES } from "@/lib/rules";

const DIVIDEND_MIN_MONTHS = DEFAULT_RULES.dividendMinMonths;

export default async function HomePage() {
  const user = await requireUser();
  const year = await currentYear();
  const totals = user.member && year ? await memberYearTotals(user.member.id, year) : null;
  const name = user.member ? [user.member.title, user.member.fullName].filter(Boolean).join(" ") : displayPhone(user.phone);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm tracking-[0.2em] text-gold-dark uppercase">Welcome</p>
        <h1 className="mt-1 font-display text-3xl text-ink">{name}</h1>
        {user.member ? <p className="mt-1 text-sm text-muted">{user.member.memberNo}</p> : null}
      </div>

      {totals && year ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={`My savings ${year.label}`} value={formatNaira(totals.contributions, { compact: true })} note={`Paid in ${totals.monthsContributed} of 12 months`} />
            <Stat label="My loan" value="No loan" note="Loans open in phase 3" />
            <Stat
              label="Dividend"
              value={totals.monthsContributed >= DIVIDEND_MIN_MONTHS ? "Qualified" : `${DIVIDEND_MIN_MONTHS - totals.monthsContributed} more months`}
              note={`Members who pay in ${DIVIDEND_MIN_MONTHS}+ months share the dividend`}
            />
          </div>
          <Card title="My payments this year">
            <PaymentHistory memberId={user.member!.id} />
          </Card>
          <Notice>Pay into GT Bank, account 0033550876, then keep your receipt. Uploading receipts in the app is coming soon.</Notice>
        </>
      ) : null}

      {hasRole(user, ...OFFICER_ROLES) ? (
        <Card title="Office">
          <div className="flex flex-wrap gap-2">
            {hasRole(user, ...PAYMENT_ROLES) ? <LinkButton href="/office/payments/new">Record payment</LinkButton> : null}
            <LinkButton href="/office/sheet" variant="secondary">Monthly sheet</LinkButton>
            <LinkButton href="/office/members" variant="secondary">Members</LinkButton>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
