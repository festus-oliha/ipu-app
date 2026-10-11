"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

/** Tabs under the header; scroll sideways on small phones. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3">
      {items.map((item) => {
        const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-11 shrink-0 items-center border-b-[3px] px-3 text-sm font-semibold whitespace-nowrap ${
              active ? "border-gold text-ivory" : "border-transparent text-ivory/75 hover:text-ivory"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
