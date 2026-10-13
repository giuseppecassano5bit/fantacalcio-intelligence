export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <svg viewBox="0 0 64 64" className="h-10 w-10" aria-hidden>
            <rect width="64" height="64" rx="14" fill="var(--prato)" />
            <rect x="10" y="12" width="44" height="40" rx="3" fill="none" stroke="var(--prato-ink)" strokeWidth="3" />
            <line x1="10" y1="32" x2="54" y2="32" stroke="var(--prato-ink)" strokeWidth="3" />
            <circle cx="32" cy="32" r="7" fill="none" stroke="var(--prato-ink)" strokeWidth="3" />
          </svg>
          <div>
            <div className="font-display text-2xl font-bold leading-none">FantaIntelligence</div>
            <div className="text-sm text-ink-2">La formazione migliore con i dati di oggi</div>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5">{children}</div>
      </div>
    </div>
  );
}
