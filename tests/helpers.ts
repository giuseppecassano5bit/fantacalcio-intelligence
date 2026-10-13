import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { openDb } from "@/lib/db";
import type { PlayerInput, MatchInfo } from "@/lib/model/inputs";
import type { SimParams } from "@/lib/model/evaluate";

/** Database SQLite temporaneo con tutte le migrazioni applicate. */
export function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fi-test-"));
  return openDb(path.join(dir, "test.sqlite"));
}

export function player(over: Partial<PlayerInput> = {}): PlayerInput {
  return {
    id: 1,
    name: "Giocatore Test",
    role: "A",
    rolesMantra: null,
    teamId: 10,
    teamName: "Squadra A",
    status: "disponibile",
    statusSource: "test",
    statusUpdatedAt: null,
    penaltyOrder: null,
    penaltyOrderSource: null,
    officialVerified: true,
    lastVerifiedAt: null,
    ...over,
  };
}

export function match(over: Partial<MatchInfo> = {}): MatchInfo {
  return {
    id: 100,
    matchday: 7,
    kickoff: new Date(Date.now() + 48 * 3600_000).toISOString(),
    kickoffKnown: true,
    status: "programmata",
    isHome: true,
    teamId: 10,
    oppId: 20,
    oppName: "Squadra B",
    ...over,
  };
}

export function simParams(over: Partial<SimParams> = {}): SimParams {
  return {
    playerId: 1,
    role: "A",
    teamId: 10,
    oppId: 20,
    pStart: 0.9,
    pSub: 0.05,
    pVoteIfSub: 0.55,
    minStart: 80,
    minSub: 20,
    goal90: 0.4,
    assist90: 0.15,
    yellow90: 0.15,
    red90: 0.01,
    og90: 0.002,
    penPerMatch: 0.27,
    pTaker: 0,
    penMiss: 0.22,
    conceded90: 1.2,
    penAgainstPerMatch: 0.27,
    penSaveRate: 0.2,
    voteMean: 6,
    voteSd: 0.5,
    ...over,
  };
}
