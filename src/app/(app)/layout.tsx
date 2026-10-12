import { redirect } from "next/navigation";
import { NavLinks, type NavItem } from "@/components/NavLinks";
import Link from "next/link";
import { Seal } from "@/components/Seal";
import { OFFICER_ROLES, PAYMENT_ROLES, hasRole, requireUser } from "@/lib/auth";
import { logout } from "../login/actions";

/** Frame for every signed-in page: header, menu by role, content. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");

  const officer = hasRole(user, ...OFFICER_ROLES);
  const items: NavItem[] = [{ href: "/", label: "Home" }];
  if (officer) items.push({ href: "/office/dashboard", label: "Dashboard" }, { href: "/office/sheet", label: "Monthly sheet" });
  if (hasRole(user, ...PAYMENT_ROLES)) items.push({ href: "/office/payments/new", label: "Record payment" });
  if (hasRole(user, ...PAYMENT_ROLES)) items.push({ href: "/office/receipts", label: "Receipts" });
  if (officer) {
    items.push({ href: "/office/loans", label: "Loans" }, { href: "/office/members", label: "Members" }, { href: "/office/debtors", label: "Debtors" });
    items.push({ href: "/office", label: "More", exact: true });
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-forest text-ivory print:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 pt-3 pb-1">
          <div className="flex min-w-0 items-center gap-3">
            <Seal size={40} variant="reverse" />
            <span className="truncate font-display text-lg">Iyobor Progressive Union</span>
          </div>
          <div className="flex shrink-0 items-center">
            <Link href="/profile" className="flex h-11 items-center rounded-lg px-3 text-sm font-semibold text-gold-light hover:bg-forest-dark">
              My profile
            </Link>
            <form action={logout}>
              <button type="submit" className="h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-gold-light hover:bg-forest-dark">
                Sign out
              </button>
            </form>
          </div>
        </div>
        {items.length > 1 ? <NavLinks items={items} /> : <div className="h-2" />}
        <div className="h-1 bg-gold" />
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
