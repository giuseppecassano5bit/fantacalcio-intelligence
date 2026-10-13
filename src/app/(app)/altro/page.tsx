import Link from "next/link";
import { Scale, Rss, History, Settings, LogOut, FlaskConical } from "lucide-react";
import { requireContext } from "@/lib/auth/session";
import { logoutAction, setModeAction } from "@/app/actions/auth";

export const metadata = { title: "Altro" };

const LINKS = [
  { href: "/ballottaggi", label: "Ballottaggi", text: "Confronta due o più giocatori", icon: Scale },
  { href: "/fonti", label: "Fonti e aggiornamenti", text: "Stato delle fonti, import dei file, notizie", icon: Rss },
  { href: "/storico", label: "Storico", text: "Formazioni passate e affidabilità delle previsioni", icon: History },
  { href: "/impostazioni", label: "Impostazioni", text: "Regolamento della lega e account", icon: Settings },
];

export default async function AltroPage() {
  const { user, mode } = await requireContext();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold tracking-tight">Altro</h1>
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {LINKS.map(({ href, label, text, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <Icon size={20} className="text-prato" aria-hidden />
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="block text-sm text-ink-2">{text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <form action={setModeAction}>
          <input type="hidden" name="mode" value={mode === "demo" ? "reale" : "demo"} />
          <button className="btn btn-ghost">
            <FlaskConical size={16} aria-hidden />
            {mode === "demo" ? "Esci dalla modalità demo" : "Prova la modalità demo"}
          </button>
        </form>
        <form action={logoutAction}>
          <button className="btn btn-ghost">
            <LogOut size={16} aria-hidden />
            Esci ({user.username})
          </button>
        </form>
      </div>
    </div>
  );
}
