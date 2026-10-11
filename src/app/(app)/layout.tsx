import { redirect } from "next/navigation";
import { NavLinks, type NavItem } from "@/components/NavLinks";
import { Seal } from "@/components/Seal";
import { OFFICER_ROLES, PAYMENT_ROLES, hasRole, requireUser } from "@/lib/auth";
import { logout } from "../login/actions";

/** Frame for every signed-in page: header, menu by role, content. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");

  const items: NavItem[] = [{ href: "/", label: "Home" }];
  if (hasRole(user, ...OFFICER_ROLES)) items.push({ href: "/office/sheet", label: "Monthly sheet" });
  if (hasRole(user, ...PAYMENT_ROLES)) items.push({ href: "/office/payments/new", label: "Record payment" });
  if (hasRole(user, ...OFFICER_ROLES)) items.push({ href: "/office/members", label: "Members" });

  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-forest text-ivory">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 pt-3 pb-1">
          <div className="flex min-w-0 items-center gap-3">
            <Seal size={40} variant="reverse" />
            <span className="truncate font-display text-lg">Iyobor Progressive Union</span>
          </div>
          <form action={logout}>
            <button type="submit" className="h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-gold-light hover:bg-forest-dark">
              Sign out
            </button>
          </form>
        </div>
        {items.length > 1 ? <NavLinks items={items} /> : <div className="h-2" />}
        <div className="h-1 bg-gold" />
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">{children}</main>
    </div>
  );
}
