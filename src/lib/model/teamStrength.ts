import { LEAGUE_PRIORS } from "./priors";

export interface PlayedMatch {
  homeId: number;
  awayId: number;
  homeGoals: number;
  awayGoals: number;
  kickoff: string | null;
}

export interface AdvancedTeamStats {
  matches: number | null;
  xgFor: number | null;
  xgAgainst: number | null;
  shotsFor: number | null;
  shotsAgainst: number | null;
}

export interface TeamRating {
  teamId: number;
  games: number;
  gf: number;
  ga: number;
  homeGames: number;
  awayGames: number;
  homeGf: number;
  homeGa: number;
  awayGf: number;
  awayGa: number;
  cleanSheets: number;
  attack: number; // 1 = media campionato
  defence: number; // >1 = concede più della media
  last5: { gf: number; ga: number; games: number; points: number; form: string };
  last10: { gf: number; ga: number; games: number; points: number };
  advanced: AdvancedTeamStats | null;
  usesAdvanced: boolean;
}

export interface LeagueTable {
  ratings: Map<number, TeamRating>;
  avgGoals: number; // gol per squadra per partita
  homeGoals: number;
  awayGoals: number;
  matchesPlayed: number;
  usesPriorsOnly: boolean;
}

const shrink = (observed: number, games: number, prior: number, k: number) => (observed * games + prior * k) / (games + k);

/** Stima forza offensiva e difensiva di ogni squadra dai risultati (con eventuali dati avanzati). */
export function buildLeagueTable(matches: PlayedMatch[], advanced: Map<number, AdvancedTeamStats> = new Map()): LeagueTable {
  const k = LEAGUE_PRIORS.teamShrinkGames;
  const n = matches.length;
  const totHome = matches.reduce((s, m) => s + m.homeGoals, 0);
  const totAway = matches.reduce((s, m) => s + m.awayGoals, 0);
  // medie di campionato: con poche partite si parte dai valori a priori
  const priorWeight = 40;
  const homeGoals = (totHome + LEAGUE_PRIORS.homeGoals * priorWeight) / (n + priorWeight);
  const awayGoals = (totAway + LEAGUE_PRIORS.awayGoals * priorWeight) / (n + priorWeight);
  const avgGoals = (homeGoals + awayGoals) / 2;

  const byTeam = new Map<number, PlayedMatch[]>();
  for (const m of matches) {
    for (const id of [m.homeId, m.awayId]) {
      if (!byTeam.has(id)) byTeam.set(id, []);
      byTeam.get(id)!.push(m);
    }
  }
  for (const id of advanced.keys()) if (!byTeam.has(id)) byTeam.set(id, []);

  const ratings = new Map<number, TeamRating>();
  for (const [teamId, ms] of byTeam) {
    const sorted = [...ms].sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));
    let gf = 0, ga = 0, hg = 0, ag = 0, hgf = 0, hga = 0, agf = 0, aga = 0, cs = 0;
    for (const m of sorted) {
      const home = m.homeId === teamId;
      const f = home ? m.homeGoals : m.awayGoals;
      const a = home ? m.awayGoals : m.homeGoals;
      gf += f;
      ga += a;
      if (a === 0) cs++;
      if (home) { hg++; hgf += f; hga += a; } else { ag++; agf += f; aga += a; }
    }
    const games = sorted.length;
    const recent = (count: number) => {
      const r = sorted.slice(-count);
      let rgf = 0, rga = 0, pts = 0;
      let form = "";
      for (const m of r) {
        const home = m.homeId === teamId;
        const f = home ? m.homeGoals : m.awayGoals;
        const a = home ? m.awayGoals : m.homeGoals;
        rgf += f;
        rga += a;
        pts += f > a ? 3 : f === a ? 1 : 0;
        form += f > a ? "V" : f === a ? "N" : "P";
      }
      return { gf: rgf, ga: rga, games: r.length, points: pts, form };
    };
    // forza su gol: rapporto rispetto alla media attesa dato casa/trasferta
    const expGf = hg * homeGoals + ag * awayGoals;
    const expGa = hg * awayGoals + ag * homeGoals;
    let attack = games > 0 ? shrink(gf / Math.max(expGf, 0.01), games, 1, k) : 1;
    let defence = games > 0 ? shrink(ga / Math.max(expGa, 0.01), games, 1, k) : 1;
    const adv = advanced.get(teamId) ?? null;
    let usesAdvanced = false;
    if (adv && adv.matches && adv.matches > 0 && adv.xgFor != null && adv.xgAgainst != null) {
      // gli xG sono più stabili dei gol: li pesiamo di più
      const xAtt = shrink(adv.xgFor / adv.matches / avgGoals, adv.matches, 1, k);
      const xDef = shrink(adv.xgAgainst / adv.matches / avgGoals, adv.matches, 1, k);
      attack = 0.4 * attack + 0.6 * xAtt;
      defence = 0.4 * defence + 0.6 * xDef;
      usesAdvanced = true;
    }
    const last5 = recent(5);
    ratings.set(teamId, {
      teamId,
      games,
      gf,
      ga,
      homeGames: hg,
      awayGames: ag,
      homeGf: hgf,
      homeGa: hga,
      awayGf: agf,
      awayGa: aga,
      cleanSheets: cs,
      attack,
      defence,
      last5,
      last10: recent(10),
      advanced: adv,
      usesAdvanced,
    });
  }
  return { ratings, avgGoals, homeGoals, awayGoals, matchesPlayed: n, usesPriorsOnly: n === 0 };
}

export interface MatchExpectation {
  teamGoals: number; // gol attesi della squadra del giocatore
  oppGoals: number; // gol attesi dell'avversario
  teamSeasonAvg: number; // gol medi attesi della squadra in una partita "media"
  attackFactor: number; // teamGoals / teamSeasonAvg
  isHome: boolean;
  basedOnGames: { team: number; opp: number };
}

export function expectMatch(table: LeagueTable, teamId: number, oppId: number, isHome: boolean): MatchExpectation {
  const t = table.ratings.get(teamId);
  const o = table.ratings.get(oppId);
  const att = t?.attack ?? 1;
  const def = t?.defence ?? 1;
  const oAtt = o?.attack ?? 1;
  const oDef = o?.defence ?? 1;
  const base = isHome ? table.homeGoals : table.awayGoals;
  const baseOpp = isHome ? table.awayGoals : table.homeGoals;
  const teamGoals = base * att * oDef;
  const oppGoals = baseOpp * oAtt * def;
  const teamSeasonAvg = table.avgGoals * att;
  return {
    teamGoals,
    oppGoals,
    teamSeasonAvg,
    attackFactor: teamSeasonAvg > 0 ? teamGoals / teamSeasonAvg : 1,
    isHome,
    basedOnGames: { team: t?.games ?? 0, opp: o?.games ?? 0 },
  };
}

export interface DefenceProfile {
  labels: string[];
  basis: "gol" | "gol+avanzati";
  goalsAgainstPerGame: number | null;
  xgaPerGame: number | null;
  shotsAgainstPerGame: number | null;
  cleanSheetRate: number | null;
  note: string;
}

/**
 * Profilo difensivo di una squadra. Non giudica una difesa "facile" solo dai gol subiti:
 * se mancano dati avanzati lo dichiara esplicitamente.
 */
export function defenceProfile(table: LeagueTable, teamId: number): DefenceProfile {
  const r = table.ratings.get(teamId);
  if (!r || r.games === 0) {
    return { labels: [], basis: "gol", goalsAgainstPerGame: null, xgaPerGame: null, shotsAgainstPerGame: null, cleanSheetRate: null, note: "Nessuna partita disputata registrata: profilo non disponibile." };
  }
  const gapg = r.ga / r.games;
  const labels: string[] = [];
  const avg = table.avgGoals;
  const adv = r.advanced;
  const xgapg = adv?.matches && adv.xgAgainst != null ? adv.xgAgainst / adv.matches : null;
  const sapg = adv?.matches && adv.shotsAgainst != null ? adv.shotsAgainst / adv.matches : null;
  if (gapg >= avg * 1.2) labels.push("Concede molti gol");
  else if (gapg <= avg * 0.8) labels.push("Concede pochi gol");
  if (xgapg != null) {
    if (gapg <= avg * 0.9 && xgapg >= avg * 1.1) labels.push("Concede pochi gol ma molte occasioni (xGA alto)");
    if (gapg >= avg * 1.1 && xgapg <= avg * 0.95) labels.push("Ha subito più gol di quanto suggeriscano le occasioni concesse");
    if (xgapg <= avg * 0.85) labels.push("Concede poche occasioni pericolose");
  }
  if (sapg != null && sapg <= 10) labels.push("Subisce pochi tiri");
  if (sapg != null && sapg >= 15) labels.push("Subisce molti tiri");
  const csr = r.cleanSheets / r.games;
  if (r.games >= 4 && csr >= 0.4) labels.push("Mantiene spesso la porta inviolata");
  const basis = xgapg != null || sapg != null ? "gol+avanzati" : "gol";
  const note =
    basis === "gol"
      ? `Profilo basato solo sui gol (${r.games} partite): dati avanzati (xGA, tiri concessi) non disponibili, affidabilità limitata.`
      : `Profilo basato su gol e dati avanzati (${r.games} partite).`;
  return { labels, basis, goalsAgainstPerGame: gapg, xgaPerGame: xgapg, shotsAgainstPerGame: sapg, cleanSheetRate: csr, note };
}
