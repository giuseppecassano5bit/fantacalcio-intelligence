"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LayoutDashboard, Users, CalendarDays, Shirt, Scale, Rss, History, Settings, MoreHorizontal } from "lucide-react";
import { cx } from "@/components/ui";

export const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, mobile: true },
  { href: "/formazione", label: "Formazione", icon: Shirt, mobile: true },
  { href: "/rosa", label: "La mia rosa", icon: Users, mobile: true },
  { href: "/giornata", label: "Analisi giornata", icon: CalendarDays, mobile: true },
  { href: "/ballottaggi", label: "Ballottaggi", icon: Scale, mobile: false },
  { href: "/fonti", label: "Fonti e aggiornamenti", icon: Rss, mobile: false },
  { href: "/storico", label: "Storico", icon: History, mobile: false },
  { href: "/impostazioni", label: "Impostazioni", icon: Settings, mobile: false },
];

function useHref() {
  const sp = useSearchParams();
  const g = sp.get("g");
  return (href: string) => (g ? `${href}?g=${g}` : href);
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SideNav() {
  const pathname = usePathname();
  const withG = useHref();
  return (
    <nav aria-label="Sezioni" className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={withG(href)}
          aria-current={isActive(pathname, href) ? "page" : undefined}
          className={cx(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-[0.95rem] font-medium",
            isActive(pathname, href) ? "bg-prato-tint text-prato" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
          )}
        >
          <Icon size={18} aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const withG = useHref();
  const items = NAV.filter((n) => n.mobile);
  const moreActive = NAV.filter((n) => !n.mobile).some((n) => isActive(pathname, n.href)) || pathname.startsWith("/altro");
  return (
    <nav aria-label="Sezioni principali" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {items.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={withG(href)}
              aria-current={isActive(pathname, href) ? "page" : undefined}
              className={cx("flex flex-col items-center gap-0.5 py-2 text-[0.7rem] font-semibold", isActive(pathname, href) ? "text-prato" : "text-ink-3")}
            >
              <Icon size={20} aria-hidden />
              {label === "La mia rosa" ? "Rosa" : label === "Analisi giornata" ? "Giornata" : label}
            </Link>
          </li>
        ))}
        <li>
          <Link href={withG("/altro")} className={cx("flex flex-col items-center gap-0.5 py-2 text-[0.7rem] font-semibold", moreActive ? "text-prato" : "text-ink-3")}>
            <MoreHorizontal size={20} aria-hidden />
            Altro
          </Link>
        </li>
      </ul>
    </nav>
  );
}
