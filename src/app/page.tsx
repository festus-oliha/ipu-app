import { redirect } from "next/navigation";
import { Seal } from "@/components/Seal";
import { OFFICER_ROLES, hasRole, requireUser } from "@/lib/auth";
import { displayPhone } from "@/lib/phone";
import { logout } from "./login/actions";

const ROLE_NAMES: Record<string, string> = {
  ADMIN: "Admin",
  PRESIDENT: "President",
  TREASURER: "Treasurer",
  SECRETARY: "Secretary",
  AUDITOR: "Auditor",
  MEMBER: "Member",
};

export default async function HomePage() {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");

  const name = user.member ? [user.member.title, user.member.fullName].filter(Boolean).join(" ") : displayPhone(user.phone);
  const isOfficer = hasRole(user, ...OFFICER_ROLES);

  return (
    <main className="flex flex-1 flex-col">
      <header className="bg-forest text-ivory">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-3">
            <Seal size={40} variant="reverse" />
            <span className="font-display text-lg">Iyobor Progressive Union</span>
          </div>
          <form action={logout}>
            <button type="submit" className="h-11 rounded-lg px-3 text-sm font-semibold text-gold-light hover:bg-forest-dark">
              Sign out
            </button>
          </form>
        </div>
        <div className="h-1 bg-gold" />
      </header>

      <div className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">
        <p className="text-sm uppercase tracking-[0.2em] text-gold-dark">Welcome</p>
        <h1 className="mt-1 font-display text-3xl text-ink">{name}</h1>
        <p className="mt-1 text-sm text-muted">
          {user.member ? `${user.member.memberNo} · ` : ""}
          {user.roles.map((r) => ROLE_NAMES[r]).join(", ")}
        </p>

        <section className="mt-8 rounded-xl border border-line bg-white p-6">
          <h2 className="font-display text-xl text-forest">The app is being built</h2>
          <p className="mt-2 max-w-prose text-base text-ink">
            Signing in works. Your savings, loan and interest will appear here in phase 2
            {isOfficer ? ", and the Office menu (members, monthly sheet, record payment) will follow." : "."}
          </p>
        </section>
      </div>
    </main>
  );
}
