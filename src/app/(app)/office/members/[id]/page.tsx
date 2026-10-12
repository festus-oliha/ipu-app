import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, LinkButton, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { MEMBER_ADMIN_ROLES, OFFICER_ROLES, hasRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatNaira } from "@/lib/money";
import { currentYear } from "@/lib/periods";
import { displayPhone } from "@/lib/phone";
import { memberYearTotals } from "@/lib/ledger";
import { resetMemberPassword, setMemberRoles, updateMember } from "../actions";
import { MemberForm } from "../MemberForm";
import { ResetPasswordForm, RolesForm } from "./AccountForms";
import { PaymentHistory } from "@/components/PaymentHistory";
import { PhotoForm } from "@/components/PhotoForm";
import { uploadPhoto } from "@/app/(app)/profile/photo";

export const metadata: Metadata = { title: "Member" };

const naira = (kobo: bigint) => (kobo === 0n ? "" : (Number(kobo) / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 }));

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(...OFFICER_ROLES);
  const { id } = await params;
  const member = await db.member.findUnique({ where: { id }, include: { user: { include: { roles: true } } } });
  if (!member) notFound();

  const year = await currentYear();
  const totals = year ? await memberYearTotals(member.id, year) : null;
  const canEdit = hasRole(user, ...MEMBER_ADMIN_ROLES);
  const roles = member.user?.roles.map((r) => r.role) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={member.memberNo} title={[member.title, member.fullName].filter(Boolean).join(" ")}>
        <StatusBadge status={member.status} />
        <LinkButton href={`/statement/${member.id}`} variant="secondary">Statement</LinkButton>
        {member.status !== "EXITED" ? <LinkButton href={`/documents/id-card/${member.id}`} variant="secondary">ID card</LinkButton> : null}
        {member.status !== "EXITED" ? <LinkButton href={`/documents/certificate/${member.id}`} variant="secondary">Certificate</LinkButton> : null}
      </PageHeader>
      <p className="-mt-3 text-sm text-muted">
        {displayPhone(member.phone)}
        {roles.filter((r) => r !== "MEMBER").length ? ` · ${roles.filter((r) => r !== "MEMBER").map((r) => r.charAt(0) + r.slice(1).toLowerCase()).join(", ")}` : ""}
      </p>

      {totals && year ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={`Savings ${year.label}`} value={formatNaira(totals.savings, { compact: true })} note={`${totals.monthsContributed} of 12 months`} />
          <Stat label="Loan limit" value={formatNaira(member.usualMonthlyKobo * 12n, { compact: true })} note="Usual monthly × 12" />
          <Stat label="Membership fees" value={formatNaira(totals.membershipFees, { compact: true })} />
        </div>
      ) : null}

      <Card title="Payments this year">
        <PaymentHistory memberId={member.id} canReverse={hasRole(user, "ADMIN", "TREASURER")} />
      </Card>

      {canEdit ? (
        <>
          <Card title="Photo for the ID card">
            <PhotoForm action={uploadPhoto.bind(null, member.id)} memberId={member.id} name={[member.title, member.fullName].filter(Boolean).join(" ")} version={member.photoKey} />
          </Card>
          <Card title="Details">
            <MemberForm
              action={updateMember.bind(null, member.id)}
              mode="edit"
              initial={{
                title: member.title ?? "",
                fullName: member.fullName,
                phone: member.phone ? displayPhone(member.phone) : "",
                email: member.email ?? "",
                occupation: member.occupation ?? "",
                address: member.address ?? "",
                bankName: member.bankName ?? "",
                accountNumber: member.accountNumber ?? "",
                yearJoined: member.yearJoined ? String(member.yearJoined) : "",
                usualMonthly: naira(member.usualMonthlyKobo),
                emergencyName: member.emergencyName ?? "",
                emergencyPhone: member.emergencyPhone ? displayPhone(member.emergencyPhone) : "",
                status: member.status,
              }}
            />
          </Card>
          <div className="grid gap-6 md:grid-cols-2">
            {hasRole(user, "ADMIN") ? (
              <Card title="Login">
                <ResetPasswordForm action={resetMemberPassword.bind(null, member.id)} hasLogin={Boolean(member.userId)} />
              </Card>
            ) : null}
            {hasRole(user, "ADMIN") ? (
              <Card title="Office roles">
                <RolesForm action={setMemberRoles.bind(null, member.id)} current={roles} />
              </Card>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
