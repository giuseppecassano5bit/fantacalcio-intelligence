import type { Db } from "@/lib/db";
import { all, one, run, nowIso, tx } from "@/lib/db";
import { matchName, normalizeName, teamKey, type MatchResult } from "@/lib/domain/text";
import type { RoleClassic } from "@/lib/domain/settings";
import { SEASON_CODE, upsertTeam } from "./league";

export type PlayerStatus = "disponibile" | "in_dubbio" | "infortunato" | "squalificato" | "da_verificare" | "fuori_rosa";
export const STATUS_LABEL: Record<PlayerStatus, string> = {
  disponibile: "Disponibile",
  in_dubbio: "In dubbio",
  infortunato: "Infortunato",
  squalificato: "Squalificato",
  da_verificare: "Da verificare",
  fuori_rosa: "Non in rosa Serie A",
};

export interface PlayerRow {
  id: number;
  full_name: string;
  name_key: string;
  birth_date: string | null;
  role_classic: RoleClassic | null;
  role_classic_source: string | null;
  roles_mantra: string | null;
  real_position: string | null;
  current_team_id: number | null;
  status: PlayerStatus;
  status_source: string | null;
  status_updated_at: string | null;
  origin: "api" | "import" | "manuale";
  official_verified: number;
  last_verified_at: string | null;
  penalty_order: number | null;
  penalty_order_source: string | null;
  created_at: string;
  updated_at: string;
  team_name: string | null;
  team_key: string | null;
}

const PLAYER_SELECT = `SELECT p.*, t.name AS team_name, t.canonical_key AS team_key FROM players p LEFT JOIN teams t ON t.id = p.current_team_id`;

export function getPlayer(db: Db, id: number): PlayerRow | undefined {
  return one<PlayerRow>(db, `${PLAYER_SELECT} WHERE p.id = ?`, [id]);
}

export function getPlayers(db: Db, ids: number[]): PlayerRow[] {
  if (ids.length === 0) return [];
  return all<PlayerRow>(db, `${PLAYER_SELECT} WHERE p.id IN (${ids.map(() => "?").join(",")})`, ids);
}

export function allPlayers(db: Db): PlayerRow[] {
  return all<PlayerRow>(db, `${PLAYER_SELECT} ORDER BY p.full_name`);
}

export function countPlayers(db: Db): number {
  return one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM players")?.n ?? 0;
}

/** Ricerca con suggerimenti: restituisce i migliori candidati per il testo digitato. */
export function searchPlayers(db: Db, q: string, limit = 12): (PlayerRow & { score: number })[] {
  const norm = normalizeName(q);
  if (norm.length < 2) return [];
  const first = norm.split(" ").sort((a, b) => b.length - a.length)[0];
  const rows = all<PlayerRow>(db, `${PLAYER_SELECT} WHERE p.name_key LIKE ? LIMIT 400`, [`%${first.slice(0, Math.max(3, first.length - 1))}%`]);
  const pool = rows.length > 0 ? rows : all<PlayerRow>(db, `${PLAYER_SELECT} LIMIT 3000`);
  const res = matchName(
    q,
    pool.map((p) => ({ ...p, id: p.id, fullName: p.full_name, teamKey: p.team_key })),
    { minScore: 45 },
  );
  return res.candidates.map((c) => ({ ...c.item, score: c.score })).slice(0, limit);
}

export function matchPlayerName(db: Db, name: string, team?: string | null): MatchResult<PlayerRow & { fullName: string; teamKey: string | null }> {
  const norm = normalizeName(name);
  const tokens = norm.split(" ").filter((t) => t.length > 1);
  const longest = tokens.sort((a, b) => b.length - a.length)[0] ?? norm;
  const rows = all<PlayerRow>(db, `${PLAYER_SELECT} WHERE p.name_key LIKE ?`, [`%${longest.slice(0, Math.max(3, longest.length - 1))}%`]);
  return matchName(
    name,
    rows.map((p) => ({ ...p, fullName: p.full_name, teamKey: p.team_key })),
    { teamKey: team ? teamKey(team) : null },
  );
}

export interface PlayerUpsert {
  fullName: string;
  team?: string | null;
  roleClassic?: RoleClassic | null;
  roleClassicSource?: string | null;
  rolesMantra?: string | null;
  realPosition?: string | null;
  birthDate?: string | null;
  source: string; // es. football-data, listone
  externalId?: string | number | null;
  origin: "api" | "import" | "manuale";
}

/**
 * Inserisce o aggiorna un giocatore del catalogo, abbinandolo per identificativo esterno
 * oppure per nome+squadra. Un cambio di squadra viene registrato come trasferimento:
 * il giocatore NON viene rimosso da nessuna rosa personale.
 */
export function upsertPlayer(db: Db, p: PlayerUpsert, matchedId?: number | null): { id: number; created: boolean; transferred: boolean } {
  return tx(db, () => {
    const now = nowIso();
    const teamId = p.team ? upsertTeam(db, p.team) : null;
    let id: number | null = matchedId ?? null;
    if (!id && p.externalId != null) {
      id = one<{ player_id: number }>(db, "SELECT player_id FROM player_external_ids WHERE source = ? AND external_id = ?", [p.source, String(p.externalId)])?.player_id ?? null;
    }
    if (!id) {
      const m = matchPlayerName(db, p.fullName, p.team);
      // abbinamento automatico solo se molto sicuro (nome quasi identico e squadra coerente)
      if (m.best && m.score >= 90 && (!p.team || !m.best.team_key || m.best.team_key === teamKey(p.team))) id = m.best.id;
      else if (m.best && m.score >= 95 && p.birthDate && m.best.birth_date === p.birthDate) id = m.best.id;
    }
    let created = false;
    let transferred = false;
    if (!id) {
      id = run(
        db,
        `INSERT INTO players (full_name, name_key, birth_date, role_classic, role_classic_source, roles_mantra, real_position, current_team_id, status, origin, official_verified, last_verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'da_verificare', ?, ?, ?, ?, ?)`,
        [
          p.fullName,
          normalizeName(p.fullName),
          p.birthDate ?? null,
          p.roleClassic ?? null,
          p.roleClassic ? (p.roleClassicSource ?? p.source) : null,
          p.rolesMantra ?? null,
          p.realPosition ?? null,
          teamId,
          p.origin,
          p.origin === "manuale" ? 0 : 1,
          p.origin === "manuale" ? null : now,
          now,
          now,
        ],
      ).lastId;
      created = true;
    } else {
      const cur = getPlayer(db, id)!;
      if (teamId && cur.current_team_id && cur.current_team_id !== teamId && p.origin !== "manuale") {
        transferred = true;
        run(db, "INSERT INTO player_team_history (player_id, from_team_id, to_team_id, changed_at, source) VALUES (?, ?, ?, ?, ?)", [
          id,
          cur.current_team_id,
          teamId,
          now,
          p.source,
        ]);
      }
      // il ruolo del listone fantacalcistico ha precedenza su quello stimato dalla posizione reale
      const keepRole = cur.role_classic && cur.role_classic_source === "listone" && p.roleClassicSource !== "listone";
      run(
        db,
        `UPDATE players SET
           role_classic = CASE WHEN ? THEN role_classic ELSE COALESCE(?, role_classic) END,
           role_classic_source = CASE WHEN ? THEN role_classic_source ELSE COALESCE(?, role_classic_source) END,
           roles_mantra = COALESCE(?, roles_mantra), real_position = COALESCE(?, real_position),
           birth_date = COALESCE(birth_date, ?), current_team_id = COALESCE(?, current_team_id),
           official_verified = CASE WHEN ? = 'manuale' THEN official_verified ELSE 1 END,
           origin = CASE WHEN origin = 'manuale' AND ? <> 'manuale' THEN ? ELSE origin END,
           last_verified_at = CASE WHEN ? = 'manuale' THEN last_verified_at ELSE ? END,
           updated_at = ?
         WHERE id = ?`,
        [
          keepRole ? 1 : 0,
          p.roleClassic ?? null,
          keepRole ? 1 : 0,
          p.roleClassic ? (p.roleClassicSource ?? p.source) : null,
          p.rolesMantra ?? null,
          p.realPosition ?? null,
          p.birthDate ?? null,
          teamId,
          p.origin,
          p.origin,
          p.origin,
          p.origin,
          now,
          now,
          id,
        ],
      );
      if (transferred) {
        // traccia il trasferimento nello storico di chi ha il giocatore in rosa
        const owners = all<{ user_id: number }>(db, "SELECT user_id FROM roster_entries WHERE player_id = ? AND removed_at IS NULL", [id]);
        for (const o of owners) {
          run(db, "INSERT INTO roster_changes (user_id, player_id, action, details, created_at) VALUES (?, ?, 'trasferimento', ?, ?)", [
            o.user_id,
            id,
            JSON.stringify({ nuovaSquadra: p.team, fonte: p.source }),
            now,
          ]);
        }
      }
    }
    if (p.externalId != null) {
      run(db, "INSERT OR IGNORE INTO player_external_ids (player_id, source, external_id) VALUES (?, ?, ?)", [id, p.source, String(p.externalId)]);
    }
    return { id, created, transferred };
  });
}

export function updatePlayerManual(
  db: Db,
  id: number,
  data: { fullName?: string; team?: string | null; roleClassic?: RoleClassic | null; rolesMantra?: string | null; status?: PlayerStatus; penaltyOrder?: number | null },
  editor: string,
) {
  const now = nowIso();
  const cur = getPlayer(db, id);
  if (!cur) throw new Error("Giocatore non trovato");
  const teamId = data.team ? upsertTeam(db, data.team) : cur.current_team_id;
  run(
    db,
    `UPDATE players SET full_name = ?, name_key = ?, current_team_id = ?, role_classic = ?, role_classic_source = CASE WHEN ? <> COALESCE(role_classic,'') THEN 'manuale' ELSE role_classic_source END,
       roles_mantra = ?, status = ?, status_source = CASE WHEN ? <> status THEN ? ELSE status_source END,
       status_updated_at = CASE WHEN ? <> status THEN ? ELSE status_updated_at END,
       penalty_order = ?, penalty_order_source = CASE WHEN COALESCE(?, -1) <> COALESCE(penalty_order, -1) THEN ? ELSE penalty_order_source END,
       updated_at = ? WHERE id = ?`,
    [
      data.fullName ?? cur.full_name,
      normalizeName(data.fullName ?? cur.full_name),
      teamId,
      data.roleClassic ?? cur.role_classic,
      data.roleClassic ?? cur.role_classic ?? "",
      data.rolesMantra ?? cur.roles_mantra,
      data.status ?? cur.status,
      data.status ?? cur.status,
      `manuale (${editor})`,
      data.status ?? cur.status,
      now,
      data.penaltyOrder === undefined ? cur.penalty_order : data.penaltyOrder,
      data.penaltyOrder === undefined ? cur.penalty_order : data.penaltyOrder,
      `manuale (${editor})`,
      now,
      id,
    ],
  );
}

export function setPlayerStatus(db: Db, id: number, status: PlayerStatus, source: string) {
  run(db, "UPDATE players SET status = ?, status_source = ?, status_updated_at = ?, updated_at = ? WHERE id = ?", [status, source, nowIso(), nowIso(), id]);
}

export function playerTransfers(db: Db, playerId: number) {
  return all<{ changed_at: string; source: string; from_name: string | null; to_name: string | null }>(
    db,
    `SELECT h.changed_at, h.source, f.name AS from_name, t.name AS to_name FROM player_team_history h
     LEFT JOIN teams f ON f.id = h.from_team_id LEFT JOIN teams t ON t.id = h.to_team_id WHERE h.player_id = ? ORDER BY h.changed_at DESC`,
    [playerId],
  );
}

export function playerExternalIds(db: Db, playerId: number) {
  return all<{ source: string; external_id: string }>(db, "SELECT source, external_id FROM player_external_ids WHERE player_id = ?", [playerId]);
}

// ======================= Rosa personale =======================

export interface RosterRow extends PlayerRow {
  entry_id: number;
  added_at: string;
  purchase_price: number | null;
  notes: string | null;
}

export function getRoster(db: Db, userId: number): RosterRow[] {
  return all<RosterRow>(
    db,
    `SELECT p.*, t.name AS team_name, t.canonical_key AS team_key, r.id AS entry_id, r.added_at, r.purchase_price, r.notes
     FROM roster_entries r JOIN players p ON p.id = r.player_id LEFT JOIN teams t ON t.id = p.current_team_id
     WHERE r.user_id = ? AND r.removed_at IS NULL
     ORDER BY CASE p.role_classic WHEN 'P' THEN 1 WHEN 'D' THEN 2 WHEN 'C' THEN 3 WHEN 'A' THEN 4 ELSE 5 END, p.full_name`,
    [userId],
  );
}

export function addToRoster(db: Db, userId: number, playerId: number, opts: { price?: number | null; notes?: string | null } = {}): boolean {
  const exists = one(db, "SELECT 1 FROM roster_entries WHERE user_id = ? AND player_id = ? AND removed_at IS NULL", [userId, playerId]);
  if (exists) return false;
  const now = nowIso();
  run(db, "INSERT INTO roster_entries (user_id, player_id, added_at, purchase_price, notes) VALUES (?, ?, ?, ?, ?)", [
    userId,
    playerId,
    now,
    opts.price ?? null,
    opts.notes ?? null,
  ]);
  run(db, "INSERT INTO roster_changes (user_id, player_id, action, details, created_at) VALUES (?, ?, 'aggiunto', ?, ?)", [
    userId,
    playerId,
    JSON.stringify({ prezzo: opts.price ?? null }),
    now,
  ]);
  return true;
}

export function removeFromRoster(db: Db, userId: number, playerId: number, reason = ""): boolean {
  const now = nowIso();
  const r = run(db, "UPDATE roster_entries SET removed_at = ? WHERE user_id = ? AND player_id = ? AND removed_at IS NULL", [now, userId, playerId]);
  if (r.changes > 0) {
    run(db, "INSERT INTO roster_changes (user_id, player_id, action, details, created_at) VALUES (?, ?, 'rimosso', ?, ?)", [
      userId,
      playerId,
      JSON.stringify({ motivo: reason || null }),
      now,
    ]);
  }
  return r.changes > 0;
}

export function replaceInRoster(db: Db, userId: number, outId: number, inId: number) {
  tx(db, () => {
    removeFromRoster(db, userId, outId, "sostituito");
    addToRoster(db, userId, inId);
    run(db, "INSERT INTO roster_changes (user_id, player_id, action, details, created_at) VALUES (?, ?, 'sostituito', ?, ?)", [
      userId,
      inId,
      JSON.stringify({ sostituisce: outId }),
      nowIso(),
    ]);
  });
}

export function updateRosterEntry(db: Db, userId: number, playerId: number, data: { notes?: string | null; price?: number | null }) {
  run(db, "UPDATE roster_entries SET notes = ?, purchase_price = ? WHERE user_id = ? AND player_id = ? AND removed_at IS NULL", [
    data.notes ?? null,
    data.price ?? null,
    userId,
    playerId,
  ]);
  run(db, "INSERT INTO roster_changes (user_id, player_id, action, details, created_at) VALUES (?, ?, 'modificato', ?, ?)", [
    userId,
    playerId,
    JSON.stringify(data),
    nowIso(),
  ]);
}

export function rosterHistory(db: Db, userId: number, limit = 100) {
  return all<{ id: number; action: string; details: string | null; created_at: string; full_name: string | null; player_id: number | null }>(
    db,
    `SELECT c.id, c.action, c.details, c.created_at, p.full_name, c.player_id FROM roster_changes c LEFT JOIN players p ON p.id = c.player_id
     WHERE c.user_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
    [userId, limit],
  );
}

export function rosterPlayerIdsAllUsers(db: Db): number[] {
  return all<{ player_id: number }>(db, "SELECT DISTINCT player_id FROM roster_entries WHERE removed_at IS NULL").map((r) => r.player_id);
}

export function usersWithRoster(db: Db): number[] {
  return all<{ user_id: number }>(db, "SELECT DISTINCT user_id FROM roster_entries WHERE removed_at IS NULL").map((r) => r.user_id);
}

export { SEASON_CODE };
