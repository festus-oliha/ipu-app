import type { Metadata } from "next";
import { Card, LinkButton, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { memberYearTotals } from "@/lib/ledger";
import { memberPosition } from "@/lib/loans";
import { formatNaira } from "@/lib/money";
import { currentYear, formatDate } from "@/lib/periods";
import { displayPhone } from "@/lib/phone";
import { DetailsForm, PasswordForm } from "./ProfileForms";

export const metadata: Metadata = { title: "My profile" };

const ROLE_NAMES: Record<string, string> = { ADMIN: "Admin", PRESIDENT: "President", TREASURER: "Treasurer", SECRETARY: "Secretary", AUDITOR: "Auditor" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="text-sm text-muted sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="font-medium">{value || <span className="font-normal text-muted">Not given</span>}</dd>
    </div>
  );
}

/** Every signed-in person: their record, contact details they can update, and their password. */
export default async function ProfilePage() {
  const user = await requireUser();
  const member = user.member ? await db.member.findUnique({ where: { id: user.member.id } }) : null;
  const roles = user.roles.filter((r) => r !== "MEMBER").map((r) => ROLE_NAMES[r] ?? r);
  const year = await currentYear();
  const [totals, position] = member && year ? await Promise.all([memberYearTotals(member.id, year), memberPosition(member.id)]) : [null, null];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={member?.memberNo ?? "Account"} title={member ? [member.title, member.fullName].filter(Boolean).join(" ") : "My profile"}>
        {member ? <StatusBadge status={member.status} /> : null}
        {member ? <LinkButton href={`/statement/${member.id}`} variant="secondary">My statement</LinkButton> : null}
      </PageHeader>

      {member && totals ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Savings this year" value={formatNaira(totals.savings, { compact: true })} note={`${totals.monthsContributed} month${totals.monthsContributed === 1 ? "" : "s"} paid`} />
          <Stat label="Usual monthly" value={formatNaira(member.usualMonthlyKobo, { compact: true })} />
          <Stat label="Loan balance" value={formatNaira(position?.principal ?? 0n, { compact: true })} />
          <Stat label="Interest owed" value={formatNaira(position && position.interestOwed > 0n ? position.interestOwed : 0n, { compact: true })} note={position && position.interestOwed < 0n ? `Credit ${formatNaira(-position.interestOwed)}` : undefined} />
        </div>
      ) : null}

      <Card title="My record">
        <dl className="flex flex-col divide-y divide-line">
          <Row label="Phone (sign-in)" value={displayPhone(user.phone)} />
          {member ? (
            <>
              <Row label="Member number" value={member.memberNo} />
              <Row label="Member since" value={member.yearJoined ? String(member.yearJoined) : formatDate(member.joinedAt)} />
              <Row label="Bank for payouts" value={member.bankName || member.accountNumber ? `${member.bankName ?? ""} ${member.accountNumber ?? ""}`.trim() : ""} />
            </>
          ) : null}
          {roles.length ? <Row label="Office" value={roles.join(", ")} /> : null}
        </dl>
        <p className="mt-3 text-sm text-muted">
          To change your phone number or bank account, ask the Secretary or Admin. This protects your payouts if someone else learns your password.
        </p>
      </Card>

      {member ? (
        <Card title="Contact details">
          <DetailsForm
            details={{
              email: member.email ?? "",
              occupation: member.occupation ?? "",
              address: member.address ?? "",
              emergencyName: member.emergencyName ?? "",
              emergencyPhone: member.emergencyPhone ? displayPhone(member.emergencyPhone) : "",
            }}
          />
        </Card>
      ) : null}

      <Card title="Password">
        <PasswordForm />
      </Card>
    </div>
  );
}
