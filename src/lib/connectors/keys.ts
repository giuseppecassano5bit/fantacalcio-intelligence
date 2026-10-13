import { getDb, getState, setState } from "@/lib/db";

// Chiavi delle fonti dati. Vale prima la variabile d'ambiente (file .env, segreti di
// GitHub Codespaces), poi la chiave che l'amministratore ha incollato nella pagina Fonti.
// Le chiavi restano sul server: al browser arriva al massimo la versione mascherata.

export type ApiKeyName = "FOOTBALL_DATA_API_KEY" | "API_FOOTBALL_KEY";
export type ApiKeySource = "ambiente" | "app";

const stateKey = (name: ApiKeyName) => `api_key:${name}`;

export function apiKey(name: ApiKeyName): string {
  const env = process.env[name]?.trim();
  if (env) return env;
  return storedApiKey(name) ?? "";
}

/** Solo la chiave salvata nell'app (senza variabile d'ambiente). */
export function storedApiKey(name: ApiKeyName): string | null {
  return getState(getDb("reale"), stateKey(name));
}

export function apiKeySource(name: ApiKeyName): ApiKeySource | null {
  if (process.env[name]?.trim()) return "ambiente";
  return storedApiKey(name) ? "app" : null;
}

export function saveApiKey(name: ApiKeyName, value: string | null): void {
  setState(getDb("reale"), stateKey(name), value?.trim() || null);
}

/** Formato plausibile: le chiavi di football-data.org e API-Football sono stringhe esadecimali di 32 caratteri. */
export function validApiKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

export function maskApiKey(value: string): string {
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}
