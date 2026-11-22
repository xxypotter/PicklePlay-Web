/** Explicit opt-in (RUN_DEV_INTEGRATION=1). Never runs against production. Real DB, mocked request identity and cookies. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { and, eq, gte, inArray, like, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, authTokens, loginAttempts, players } from "@/lib/db/schema";
import { makeT } from "@/lib/i18n/translate";

const jar = new Map<string, { value: string; expires?: Date }>();
let me: { id: string; username: string; displayName: null; role: "player"; locale: null; renewDue: boolean };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, opts?: { expires?: Date }) => void jar.set(name, { value, expires: opts?.expires }),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/permissions", () => ({ requireLogin: async () => me, requireAdmin: async () => me, requireSuperAdmin: async () => me }));
vi.mock("@/lib/i18n/server", () => ({ getT: async () => makeT("en") }));

const t = makeT("en");
const db = () => getDb();

describe.skipIf(process.env.RUN_DEV_INTEGRATION !== "1")("v2.3 sign-in: change PIN, renewal, group-wide cap", () => {
  const id = randomUUID();
  const username = `v23auth_${id.slice(0, 8)}`;
  let verified = false;

  beforeAll(async () => {
    config({ path: ".env.local", quiet: true });
    if (new URL(process.env.DATABASE_URL!).pathname !== "/pickleplay_dev") throw new Error("Development DB required");
    const probe = await db().execute<{ name: string }>(sql`select current_database() as name`);
    if (probe.rows[0]?.name !== "pickleplay_dev") throw new Error("Development DB required");
    verified = true;
    const { hashPin } = await import("./pin");
    await db().insert(players).values({ id, username, usernameLower: username.toLowerCase(), pinHash: await hashPin("2468"), role: "player" });
    me = { id, username, displayName: null, role: "player", locale: null, renewDue: false };
  }, 30000);

  afterAll(async () => {
    if (!verified) return;
    await db().delete(loginAttempts).where(like(loginAttempts.usernameLower, "v23auth_%"));
    await db().delete(auditLog).where(inArray(auditLog.action, ["auth.busy"]));
    await db().delete(auditLog).where(eq(auditLog.actorId, id));
    await db().delete(players).where(eq(players.id, id));
  }, 30000);

  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  it("refuses a wrong current PIN and counts it as a failed sign-in", async () => {
    const { changePinAction } = await import("./actions");
    const r = await changePinAction({}, form({ currentPin: "1111", newPin: "1234", newPinConfirm: "1234" }));
    expect(r).toEqual({ error: t("err.currentPinWrong"), field: "currentPin" });
    const rows = await db().select().from(loginAttempts).where(eq(loginAttempts.usernameLower, username.toLowerCase()));
    expect(rows.map((x) => x.succeeded)).toEqual([false]);
  }, 30000);

  it("changes the PIN, clears failures, keeps this phone signed in and signs out the others", async () => {
    const { changePinAction } = await import("./actions");
    const { createSession } = await import("./session");
    const { verifyPin } = await import("./pin");
    await createSession(id); // "another phone"
    const otherCookie = jar.get("pp_session")!.value;

    const r = await changePinAction({}, form({ currentPin: "2468", newPin: "1111", newPinConfirm: "1111" }));
    expect(r).toEqual({ ok: t("pin.changed") });

    const [row] = await db().select({ pinHash: players.pinHash }).from(players).where(eq(players.id, id));
    expect(await verifyPin("1111", row.pinHash)).toBe(true);
    expect(await verifyPin("2468", row.pinHash)).toBe(false);
    expect(await db().select().from(loginAttempts).where(eq(loginAttempts.usernameLower, username.toLowerCase()))).toHaveLength(0);
    // Exactly one live token, and it is the new cookie, not the other phone's.
    expect(await db().select().from(authTokens).where(eq(authTokens.playerId, id))).toHaveLength(1);
    expect(jar.get("pp_session")!.value).not.toBe(otherCookie);
    const audit = await db().select().from(auditLog).where(and(eq(auditLog.actorId, id), eq(auditLog.action, "player.change_pin")));
    expect(audit).toHaveLength(1);
  }, 30000);

  it("renews a valid sign-in for another 90 days, and never revives an expired one", async () => {
    const { renewSession, getCurrentPlayer } = await import("./session");
    // The current token (from the PIN change) is about to run out.
    await db().update(authTokens).set({ expiresAt: new Date(Date.now() + 10 * 86_400_000) }).where(eq(authTokens.playerId, id));
    const before = await getCurrentPlayer();
    expect(before?.renewDue).toBe(true);

    expect(await renewSession()).toBe(true);
    const [tok] = await db().select().from(authTokens).where(eq(authTokens.playerId, id));
    const days = (tok.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(jar.get("pp_session")!.expires!.getTime()).toBe(tok.expiresAt.getTime());

    // Expired: nothing to renew, and the row stays expired.
    await db().update(authTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authTokens.playerId, id));
    expect(await renewSession()).toBe(false);
    const [still] = await db().select().from(authTokens).where(eq(authTokens.playerId, id));
    expect(still.expiresAt.getTime()).toBeLessThan(Date.now());
  }, 30000);

  it("group budget: reserved before the PIN check, real names only, logged once, known phones exempt", async () => {
    const { reserveLoginAttempt } = await import("./rate-limit");
    const { hashPin } = await import("./pin");
    const { createSession } = await import("./session");
    const { loginAction } = await import("./actions");
    const extras = Array.from({ length: 6 }, (_, i) => ({ id: randomUUID(), username: `v23auth_x${i}_${id.slice(0, 6)}` }));
    const pinHash = await hashPin("1357");
    await db().insert(players).values(extras.map((x) => ({ id: x.id, username: x.username, usernameLower: x.username.toLowerCase(), pinHash, role: "player" as const })));
    try {
      const since = new Date(Date.now() - 15 * 60_000);
      const groupNow = async () => (await db().select({ n: sql<number>`count(*)::int` }).from(loginAttempts)
        .innerJoin(players, eq(players.usernameLower, loginAttempts.usernameLower))
        .where(and(eq(loginAttempts.succeeded, false), gte(loginAttempts.attemptedAt, since))))[0].n;

      // Typos and made-up names never count toward the group budget.
      await db().insert(loginAttempts).values(Array.from({ length: 40 }, (_, i) => ({ usernameLower: `v23auth_nobody${i}`, succeeded: false })));
      const base = await groupNow();
      expect(base).toBeLessThan(26);

      // Bring real-name failures to 26, then fire ten at once: exactly four may pass.
      await db().insert(loginAttempts).values(Array.from({ length: 26 - base }, () => ({ usernameLower: username.toLowerCase(), succeeded: false })));
      const burst = await Promise.all(Array.from({ length: 10 }, (_, i) =>
        reserveLoginAttempt(extras[i % 6].username.toLowerCase(), { groupCheck: true })));
      expect(burst.filter((r) => r.ok)).toHaveLength(4);
      expect(burst.filter((r) => !r.ok && r.reason === "busy")).toHaveLength(6);
      expect(await groupNow()).toBe(30);

      const logged = await db().select().from(auditLog).where(and(eq(auditLog.action, "auth.busy"), gte(auditLog.createdAt, since)));
      expect(logged).toHaveLength(1);

      // Signed-in actions skip the group budget; a new browser is paused.
      expect(await reserveLoginAttempt(extras[5].username.toLowerCase(), { groupCheck: false })).toEqual({ ok: true });
      jar.clear();
      const paused = await loginAction({}, form({ username: extras[4].username, pin: "1357" }));
      expect(paused).toEqual({ error: t("err.signInBusy"), field: "busy" });

      // A phone that has signed in as that player before still gets in.
      await createSession(extras[4].id);
      jar.delete("pp_session");
      await expect(loginAction({}, form({ username: extras[4].username, pin: "1357" }))).rejects.toThrow("redirect:/");
    } finally {
      await db().delete(players).where(inArray(players.id, extras.map((x) => x.id)));
    }
  }, 60000);
});
