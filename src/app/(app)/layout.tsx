import { Suspense } from "react";
import Link from "next/link";
import { LogOut, FlaskConical } from "lucide-react";
import { requireContext } from "@/lib/auth/session";
import { resolveMatchday } from "@/lib/analysis/context";
import { getDb } from "@/lib/db";
import { lastSuccessfulSync, listSyncRuns } from "@/lib/repo/sync";
import { formatDateTime, formatKickoff, isOlderThan, relativeTime } from "@/lib/domain/time";
import { SideNav, BottomNav } from "@/components/shell/NavLinks";
import { MatchdaySelect } from "@/components/shell/MatchdaySelect";
import { SyncButton } from "@/components/shell/SyncButton";
import { logoutAction, setModeAction } from "@/app/actions/auth";
import { cx } from "@/components/ui";

export const dynamic = "force-dynamic";

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="FantaIntelligence, vai alla dashboard">
      <svg viewBox="0 0 64 64" className="h-8 w-8" aria-hidden>
        <rect width="64" height="64" rx="14" fill="var(--prato)" />
        <rect x="10" y="12" width="44" height="40" rx="3" fill="none" stroke="var(--prato-ink)" strokeWidth="3" />
        <line x1="10" y1="32" x2="54" y2="32" stroke="var(--prato-ink)" strokeWidth="3" />
        <circle cx="32" cy="32" r="7" fill="none" stroke="var(--prato-ink)" strokeWidth="3" />
      </svg>
      <span className="font-display text-xl font-bold leading-none tracking-tight">FantaIntelligence</span>
    </Link>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, mode, db } = await requireContext();
  const { list, matchday } = resolveMatchday(db, null);
  const real = getDb("reale");
  const last = lastSuccessfulSync(real);
  const lastRun = listSyncRuns(real, 1)[0];
  const stale = isOlderThan(last?.finished_at ?? last?.started_at, 24 * 3600_000);
  const options = list.map((m) => ({
    matchday: m.matchday,
    label: `Giornata ${m.matchday}${m.firstKickoff ? `, ${formatKickoff(m.firstKickoff, false).replace(" (orario da definire)", "")}` : ""}`,
  }));

  return (
    <div className="lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line bg-surface px-4 py-5 lg:flex">
        <Wordmark />
        <Suspense>
          <SideNav />
        </Suspense>
        <div className="mt-auto space-y-3 border-t border-line pt-4 text-sm">
          <div>
            <div className="text-ink-3">Accesso come</div>
            <div className="font-semibold">{user.username}</div>
          </div>
          <form action={setModeAction}>
            <input type="hidden" name="mode" value={mode === "demo" ? "reale" : "demo"} />
            <button className="flex items-center gap-2 text-ink-2 hover:text-ink" type="submit">
              <FlaskConical size={16} aria-hidden />
              {mode === "demo" ? "Esci dalla modalità demo" : "Prova la modalità demo"}
            </button>
          </form>
          <form action={logoutAction}>
            <button className="flex items-center gap-2 text-ink-2 hover:text-ink" type="submit">
              <LogOut size={16} aria-hidden />
              Esci
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0">
        {mode === "demo" && (
          <div className="bg-warn-tint px-4 py-2 text-center text-sm font-semibold text-warn" role="note">
            Modalità demo: squadre, giocatori e risultati sono inventati e separati dai dati reali.
          </div>
        )}
        <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 lg:px-8">
            <div className="lg:hidden">
              <Wordmark />
            </div>
            <Suspense>
              <MatchdaySelect options={options} defaultMd={matchday} />
            </Suspense>
            <Link
              href="/fonti"
              className={cx("hidden text-sm sm:inline", stale ? "text-warn" : "text-ink-2")}
              title={last ? `Ultimo aggiornamento riuscito: ${formatDateTime(last.finished_at)}` : "Nessun aggiornamento eseguito"}
            >
              {mode === "demo"
                ? "Dati fittizi"
                : last
                  ? `Dati aggiornati ${relativeTime(last.finished_at)}${lastRun && lastRun.status === "errore" ? ", ultimo tentativo fallito" : ""}`
                  : "Dati mai aggiornati"}
            </Link>
            <div className="ml-auto">
              <SyncButton disabled={mode === "demo"} disabledReason="In modalità demo non vengono contattate fonti esterne." />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-28 pt-5 lg:px-8 lg:pb-12">{children}</main>
      </div>
      <Suspense>
        <BottomNav />
      </Suspense>
    </div>
  );
}
