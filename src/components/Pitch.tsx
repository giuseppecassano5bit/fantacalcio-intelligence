/**
 * Campo disegnato "a gesso" con i titolari disposti per reparto.
 * Ogni gettone mostra ruolo (colore + lettera), cognome e punti attesi.
 */
export interface PitchPlayer {
  id: number;
  name: string;
  role: string;
  expected: number | null;
  pVote: number;
  warn: boolean;
}

const ROLE_FILL: Record<string, string> = { P: "var(--role-p)", D: "var(--role-d)", C: "var(--role-c)", A: "var(--role-a)" };

function shortName(n: string) {
  const parts = n.split(" ");
  const last = parts[parts.length - 1];
  return last.length > 11 ? `${last.slice(0, 10)}.` : last;
}

export function Pitch({ players, module }: { players: PitchPlayer[]; module: string }) {
  const W = 340;
  const H = 440;
  const lines: PitchPlayer[][] = [
    players.filter((p) => p.role === "A"),
    players.filter((p) => p.role === "C"),
    players.filter((p) => p.role === "D"),
    players.filter((p) => p.role === "P"),
  ].filter((l) => l.length);
  const ys = lines.length === 4 ? [72, 180, 288, 392] : lines.map((_, i) => 72 + (i * 320) / Math.max(1, lines.length - 1));
  return (
    <figure className="mx-auto w-full max-w-[420px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl" role="img" aria-label={`Formazione ${module} disposta sul campo`}>
        <defs>
          <pattern id="mow" width="340" height="55" patternUnits="userSpaceOnUse">
            <rect width="340" height="27.5" fill="var(--pitch)" />
            <rect y="27.5" width="340" height="27.5" fill="var(--pitch-2)" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#mow)" />
        <g fill="none" stroke="var(--chalk)" strokeOpacity="0.75" strokeWidth="2">
          <rect x="12" y="12" width={W - 24} height={H - 24} />
          <line x1="12" y1="12" x2={W - 12} y2="12" />
          <path d={`M ${W / 2 - 50} 12 A 50 50 0 0 0 ${W / 2 + 50} 12`} />
          <rect x={W / 2 - 80} y={H - 12 - 66} width="160" height="66" />
          <rect x={W / 2 - 36} y={H - 12 - 24} width="72" height="24" />
          <path d={`M ${W / 2 - 34} ${H - 78} A 40 40 0 0 1 ${W / 2 + 34} ${H - 78}`} />
          <circle cx={W / 2} cy={H - 56} r="1.8" fill="var(--chalk)" />
        </g>
        {lines.map((line, li) =>
          line.map((p, i) => {
            const x = (W * (i + 1)) / (line.length + 1);
            const y = ys[li];
            return (
              <g key={p.id} transform={`translate(${x} ${y})`}>
                <title>{`${p.name}: punti attesi ${p.expected?.toFixed(1) ?? "n.d."}, probabilità di voto ${Math.round(p.pVote * 100)}%`}</title>
                <circle r="19" fill={ROLE_FILL[p.role] ?? "#777"} stroke="var(--chalk)" strokeWidth="2.5" />
                <text textAnchor="middle" dy="6" fontSize="17" fontWeight="700" fill="#fff" style={{ fontFamily: "var(--font-display)" }}>
                  {p.expected != null ? p.expected.toFixed(1).replace(".", ",") : "–"}
                </text>
                {p.warn && (
                  <g transform="translate(15 -15)">
                    <circle r="8" fill="var(--warn)" stroke="var(--chalk)" strokeWidth="1.5" />
                    <text textAnchor="middle" dy="4" fontSize="11" fontWeight="700" fill="#fff">!</text>
                  </g>
                )}
                <text textAnchor="middle" y="36" fontSize="12.5" fontWeight="600" fill="var(--chalk)" style={{ fontFamily: "var(--font-display)" }}>
                  {shortName(p.name)}
                </text>
              </g>
            );
          }),
        )}
      </svg>
      <figcaption className="mt-2 text-center text-xs text-ink-3">Nei cerchi: punti attesi. Il punto esclamativo segnala un rischio (voto incerto o notizie da verificare).</figcaption>
    </figure>
  );
}
