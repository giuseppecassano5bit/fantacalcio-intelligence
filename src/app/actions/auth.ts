"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, one, run, nowIso } from "@/lib/db";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, loginRateLimited, requireUser, resetLoginAttempts, userCount, MODE_COOKIE } from "@/lib/auth/session";
import { saveLeagueSettings } from "@/lib/repo/data";
import { DEFAULT_CONFIG } from "@/lib/domain/settings";

export interface FormState {
  error?: string;
  ok?: string;
}

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

function validUsername(u: string) {
  return /^[a-zA-Z0-9._-]{3,32}$/.test(u);
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const ip = await clientIp();
  if (loginRateLimited(ip)) return { error: "Troppi tentativi. Riprova tra qualche minuto." };
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const row = one<{ id: number; password_hash: string }>(getDb(), "SELECT id, password_hash FROM users WHERE username = ?", [username]);
  if (!row || !verifyPassword(password, row.password_hash)) return { error: "Nome utente o password non corretti." };
  resetLoginAttempts(ip);
  await createSession(row.id);
  redirect("/");
}

/** Creazione account: il primo account è libero (configurazione iniziale); i successivi richiedono il codice invito. */
export async function registerAction(_: FormState, form: FormData): Promise<FormState> {
  const ip = await clientIp();
  if (loginRateLimited(ip)) return { error: "Troppi tentativi. Riprova tra qualche minuto." };
  const first = userCount() === 0;
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const code = String(form.get("code") ?? "").trim();
  if (first) {
    const setupToken = process.env.SETUP_TOKEN;
    if (setupToken && code !== setupToken) return { error: "Codice di configurazione non valido (variabile SETUP_TOKEN)." };
  } else {
    const invite = process.env.INVITE_CODE;
    const open = process.env.ALLOW_REGISTRATION === "true";
    if (!open && (!invite || code !== invite)) return { error: invite ? "Codice invito non valido." : "Le registrazioni sono chiuse su questa installazione." };
  }
  if (!validUsername(username)) return { error: "Nome utente: 3-32 caratteri tra lettere, numeri, punto, trattino e underscore." };
  const weak = validatePasswordStrength(password);
  if (weak) return { error: weak };
  if (password !== confirm) return { error: "Le due password non coincidono." };
  const db = getDb();
  if (one(db, "SELECT 1 FROM users WHERE username = ?", [username])) return { error: "Nome utente già in uso." };
  const id = run(db, "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)", [username, hashPassword(password), nowIso()]).lastId;
  saveLeagueSettings(db, id, DEFAULT_CONFIG, false);
  run(db, "UPDATE league_settings SET is_provisional = 1 WHERE user_id = ?", [id]);
  await createSession(id);
  redirect("/rosa?benvenuto=1");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function setModeAction(form: FormData) {
  await requireUser();
  const mode = form.get("mode") === "demo" ? "demo" : "reale";
  const jar = await cookies();
  if (mode === "demo") jar.set(MODE_COOKIE, "demo", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  else jar.delete(MODE_COOKIE);
  redirect("/");
}

export async function changePasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const db = getDb();
  const row = one<{ password_hash: string }>(db, "SELECT password_hash FROM users WHERE id = ?", [user.id]);
  if (!row || !verifyPassword(current, row.password_hash)) return { error: "Password attuale non corretta." };
  const weak = validatePasswordStrength(next);
  if (weak) return { error: weak };
  run(db, "UPDATE users SET password_hash = ? WHERE id = ?", [hashPassword(next), user.id]);
  run(db, "DELETE FROM sessions WHERE user_id = ?", [user.id]);
  await createSession(user.id);
  return { ok: "Password aggiornata. Le altre sessioni sono state chiuse." };
}
