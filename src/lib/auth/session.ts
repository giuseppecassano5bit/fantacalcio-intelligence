import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, one, run, nowIso, type DbMode } from "@/lib/db";

export const SESSION_COOKIE = "fi_session";
export const MODE_COOKIE = "fi_mode";
const SESSION_DAYS = 30;

export interface CurrentUser {
  id: number;
  username: string;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function userCount(): number {
  return one<{ n: number }>(getDb(), "SELECT COUNT(*) AS n FROM users")?.n ?? 0;
}

/** L'amministratore dell'installazione è il primo account creato. */
export function isAdmin(userId: number): boolean {
  return one<{ id: number }>(getDb(), "SELECT MIN(id) AS id FROM users")?.id === userId;
}

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const ua = (await headers()).get("user-agent")?.slice(0, 200) ?? null;
  run(getDb(), "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)", [
    sha256(token),
    userId,
    nowIso(),
    expires.toISOString(),
    ua,
  ]);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true",
    path: "/",
    expires,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) run(getDb(), "DELETE FROM sessions WHERE id = ?", [sha256(token)]);
  jar.delete(SESSION_COOKIE);
}

export function userFromToken(token: string | undefined | null): CurrentUser | null {
  if (!token) return null;
  const row = one<{ id: number; username: string; expires_at: string }>(
    getDb(),
    "SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?",
    [sha256(token)],
  );
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  return { id: row.id, username: row.username };
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userFromToken(token);
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(userCount() === 0 ? "/setup" : "/login");
  return user;
}

export async function getMode(): Promise<DbMode> {
  return (await cookies()).get(MODE_COOKIE)?.value === "demo" ? "demo" : "reale";
}

/** Utente + database del modo corrente (reale o demo, mai mescolati). */
export async function requireContext() {
  const user = await requireUser();
  const mode = await getMode();
  const db = getDb(mode);
  if (mode === "demo") {
    const { ensureDemoSeed } = await import("@/lib/demo/seed");
    ensureDemoSeed(db, user.id);
  }
  return { user, mode, db };
}

// ---- Limitazione tentativi di accesso (in memoria, per IP) ----
const attempts = new Map<string, { count: number; first: number }>();
export function loginRateLimited(ip: string): boolean {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.first > 15 * 60_000) {
    attempts.set(ip, { count: 1, first: now });
    return false;
  }
  a.count += 1;
  return a.count > 8;
}
export function resetLoginAttempts(ip: string) {
  attempts.delete(ip);
}
