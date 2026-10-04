/** Explicit opt-in. Never runs against production. Uses real DB/actions, mocked request identity only. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, matches, mlpTeams, mlpTies, players, rounds, sessions, signups } from "@/lib/db/schema";
import { makeT } from "@/lib/i18n/translate";
import type { Actor } from "@/lib/auth/policy";
import { createMlpScheduleAction, saveMlpTeamsAction } from "@/lib/mlp/actions";
import type { TeamInput } from "@/lib/mlp/rules";
import { generateAllRoundsAction, reopenSessionAction, saveScoreAction, startSessionAction } from "./play-actions";
import { createSessionAction } from "./actions";
import { updateSessionAction } from "./edit-actions";
import { loadCopySource } from "./copy-source";

let actor: Actor;
class Redirected extends Error { constructor(public url: string) { super(url); } }
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Redirected(url); },
  notFound: () => { throw new Error("notFound"); },
}));
vi.mock("@/lib/auth/permissions", () => ({ requireLogin: async () => actor, requireAdmin: async () => actor, requireSuperAdmin: async () => actor }));
vi.mock("@/lib/i18n/server", () => ({ getT: async () => makeT("en") }));

describe.skipIf(process.env.RUN_DEV_INTEGRATION !== "1")("v1.7 back to setup, clearing scores and copying with players", () => {
  const ids: string[] = Array.from({ length: 18 }, () => randomUUID());
  const [organizer, otherAdmin] = ids;
  const made: string[] = [];
  let verified = false;
  const t = makeT("en");
  const db = () => getDb();

  const newSession = async (fields: Partial<typeof sessions.$inferInsert>, roster: string[]) => {
    const id = randomUUID();
    made.push(id);
    await db().insert(sessions).values({ id, title: "Setup integration", createdBy: organizer, courtCount: 2,
      courtNames: ["1", "2"], maxPlayers: roster.length, status: "live", rated: false, startsAt: new Date(), ...fields });
    await db().insert(signups).values(roster.map((playerId, i) => ({ sessionId: id, playerId, state: "in" as const,
      createdAt: new Date(Date.now() + i * 1000) })));
    return id;
  };
  const score = (matchId: string, a: number, b: number) => {
    const fd = new FormData(); fd.set("matchId", matchId); fd.set("scoreA", String(a)); fd.set("scoreB", String(b));
    return saveScoreAction({}, fd);
  };
  const create = async (fields: Record<string, string | string[]>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(k, x);
    try { await createSessionAction({}, fd); } catch (e) {
      if (e instanceof Redirected) { const id = e.url.split("/").pop()!; made.push(id); return id; }
      throw e;
    }
    throw new Error("Create did not redirect");
  };

  beforeAll(async () => {
    config({ path: ".env.local", quiet: true });
    if (new URL(process.env.DATABASE_URL!).pathname !== "/pickleplay_dev") throw new Error("Development DB required");
    const probe = await getDb().execute<{ name: string }>(sql`select current_database() as name`);
    if (probe.rows[0]?.name !== "pickleplay_dev") throw new Error("Development DB required");
    verified = true;
    actor = { id: organizer, role: "admin" };
    await db().insert(players).values(ids.map((pid, i) => ({ id: pid, username: `v17setup_${pid}`, usernameLower: `v17setup_${pid}`,
      pinHash: "disabled-test-only", role: i < 2 ? "admin" as const : "player" as const })));
  }, 30000);
  afterAll(async () => {
    if (!verified) return;
    if (made.length) await db().delete(sessions).where(inArray(sessions.id, made));
    await db().delete(auditLog).where(inArray(auditLog.actorId, ids));
    await db().delete(players).where(inArray(players.id, ids));
  }, 30000);

  it("goes back to setup from a drawn regular session, only while nothing is scored, and only for its organizer", async () => {
    const id = await newSession({}, ids.slice(2, 10));
    await generateAllRoundsAction(id, 3);
    const games = await db().select().from(matches).where(eq(matches.sessionId, id));
    expect(games.length).toBeGreaterThan(0);

    // A scored game blocks it; the player who scored cannot clear it with 0–0.
    expect(await score(games[0].id, 11, 7)).toEqual({});
    await expect(reopenSessionAction(id)).rejects.toThrow(t("err.resultsExist"));
    actor = { id: games[0].a1, role: "player" };
    expect((await score(games[0].id, 0, 0)).error).toBe(t("schedule.error.tie"));
    // Another admin is not this session's organizer.
    actor = { id: otherAdmin, role: "admin" };
    expect((await score(games[0].id, 0, 0)).error).toBe(t("schedule.error.tie"));
    await expect(reopenSessionAction(id)).rejects.toThrow();

    // The organizer clears it; the row forgets the score and the log keeps it.
    actor = { id: organizer, role: "admin" };
    expect(await score(games[0].id, 0, 0)).toEqual({});
    const [cleared] = await db().select().from(matches).where(eq(matches.id, games[0].id));
    expect(cleared).toMatchObject({ status: "scheduled", scoreA: null, scoreB: null, enteredBy: null, editedAt: null });
    const [log] = await db().select().from(auditLog).where(and(eq(auditLog.targetId, games[0].id), eq(auditLog.action, "match.clear")));
    expect(JSON.parse(log.detail!)).toEqual({ scoreA: 11, scoreB: 7 });
    // 0–0 on an unscored match changes nothing.
    expect(await score(games[1].id, 0, 0)).toEqual({});

    await reopenSessionAction(id);
    expect(await db().select().from(matches).where(eq(matches.sessionId, id))).toHaveLength(0);
    expect(await db().select().from(rounds).where(eq(rounds.sessionId, id))).toHaveLength(0);
    expect((await db().select().from(sessions).where(eq(sessions.id, id)))[0].status).toBe("open");
    expect(await db().select().from(signups).where(eq(signups.sessionId, id))).toHaveLength(8);
    const [back] = await db().select().from(auditLog).where(and(eq(auditLog.targetId, id), eq(auditLog.action, "session.back_to_setup")));
    expect(JSON.parse(back.detail!)).toEqual({ discardedMatches: games.length });
  }, 120000);

  const teamsOf = (roster: string[]): TeamInput[] => Array.from({ length: 4 }, (_, i) => ({
    name: `Setup team ${i + 1}`, m1: roster[i * 4], w1: roster[i * 4 + 1], m2: roster[i * 4 + 2], w2: roster[i * 4 + 3],
    women1: roster[i * 4 + 1], women2: roster[i * 4 + 3], men1: roster[i * 4], men2: roster[i * 4 + 2],
  }));

  it.each([5,6])("creates, edits, copies and redraws Mini MLP with %i courts",async courts=>{
    const roster=ids.slice(2,18),courtNames=Array.from({length:courts},(_,i)=>String(i+1)).join(", ");
    const fields={title:"Extra courts",startsAt:new Date().toISOString(),courtNames,format:"mlp",maxPlayers:"16"};
    const id=await create({...fields,invite:roster});
    await saveMlpTeamsAction(id,teamsOf(roster));
    const fd=new FormData();for(const [k,v] of Object.entries({...fields,sessionId:id}))fd.set(k,v);
    await expect(updateSessionAction({},fd)).rejects.toBeInstanceOf(Redirected);
    const copy=await loadCopySource(actor,id,true);
    expect(copy!.courts).toBe(courtNames);expect(copy!.teams).toHaveLength(4);
    const copied=await create({...fields,courtNames:copy!.courts,copyFrom:id,invite:copy!.players!});
    expect(await db().select().from(mlpTeams).where(eq(mlpTeams.sessionId,copied))).toHaveLength(4);
    await startSessionAction(id);await createMlpScheduleAction(id);
    expect((await updateSessionAction({},fd)).error).toBe(t("err.sessionStarted"));
    await reopenSessionAction(id);await startSessionAction(id);await createMlpScheduleAction(id);
    expect((await db().select().from(sessions).where(eq(sessions.id,id)))[0].courtCount).toBe(courts);
    expect(await db().select().from(matches).where(eq(matches.sessionId,id))).toHaveLength(24);
    await reopenSessionAction(id);
    for(const action of [createSessionAction,updateSessionAction]) {
      for(const invalid of [{format:"mlp",courtNames:"1,2,3"},{format:"mlp",courtNames:"1,2,3,4,5,6,7"},
        {format:"regular",courtNames},{format:"mlp",courtNames:"1,2,3,4,4"},{format:"mlp",maxPlayers:"28"}]) {
        const bad=new FormData();for(const [k,v] of Object.entries({...fields,sessionId:id,...invalid}))bad.set(k,v);
        expect((await action({},bad)).error).toBeTruthy();
      }
    }
  },120000);

  it("undoes a Mini MLP draw once its score is cleared, keeping teams so they can be fixed and redrawn", async () => {
    const roster = ids.slice(2, 18);
    const id = await newSession({ format: "mlp", courtCount: 4, courtNames: ["1", "2", "3", "4"], maxPlayers: 16 }, roster);
    await saveMlpTeamsAction(id, teamsOf(roster), true);
    await createMlpScheduleAction(id);
    const [first] = await db().select().from(matches).where(eq(matches.sessionId, id)).limit(1);
    expect(await score(first.id, 11, 4)).toEqual({});
    await expect(reopenSessionAction(id)).rejects.toThrow(t("err.resultsExist"));
    expect(await score(first.id, 0, 0)).toEqual({});
    await reopenSessionAction(id);

    expect(await db().select().from(mlpTies).where(eq(mlpTies.sessionId, id))).toHaveLength(0);
    expect(await db().select().from(matches).where(eq(matches.sessionId, id))).toHaveLength(0);
    expect(await db().select().from(mlpTeams).where(eq(mlpTeams.sessionId, id))).toHaveLength(4);
    expect((await db().select().from(sessions).where(eq(sessions.id, id)))[0].mlpRandomMixed).toBe(true);
    // Teams are editable again: swap two players between teams, then start and redraw.
    const fixed = teamsOf(roster);
    [fixed[0].w2, fixed[1].w2] = [fixed[1].w2, fixed[0].w2];
    [fixed[0].women2, fixed[1].women2] = [fixed[0].w2, fixed[1].w2];
    await saveMlpTeamsAction(id, fixed);
    expect((await db().select().from(sessions).where(eq(sessions.id, id)))[0].mlpRandomMixed).toBe(false);
    await startSessionAction(id);
    await createMlpScheduleAction(id);
    expect(await db().select().from(matches).where(eq(matches.sessionId, id))).toHaveLength(24);
  }, 120000);

  it("copies with players: everyone in order, plus Mini MLP teams or fixed pairs when they still fit", async () => {
    const roster = ids.slice(2, 18);
    const mlpSource = await newSession({ format: "mlp", courtCount: 4, courtNames: ["1", "2", "3", "4"], maxPlayers: 16 }, roster);
    await saveMlpTeamsAction(mlpSource, teamsOf(roster), true);
    await db().update(sessions).set({ status: "closed" }).where(eq(sessions.id, mlpSource));

    const copy = await loadCopySource(actor, mlpSource, true);
    expect(copy?.mlpRandomMixed).toBe(true);
    expect((await loadCopySource(actor,mlpSource,false))?.mlpRandomMixed).toBe(true);
    expect(copy?.players).toEqual(roster);
    expect(copy?.teams).toHaveLength(4);
    const base = { title: "Copied", startsAt: new Date().toISOString(), courtNames: "1, 2, 3, 4", format: "mlp", maxPlayers: "16" };

    const whole = await create({ ...base, invite: copy!.players!, copyFrom: mlpSource,mlpRandomMixed:String(copy!.mlpRandomMixed) });
    expect((await db().select().from(sessions).where(eq(sessions.id,whole)))[0].mlpRandomMixed).toBe(true);
    const copiedTeams = await db().select().from(mlpTeams).where(eq(mlpTeams.sessionId, whole));
    const lineup = ({ name, m1, m2, w1, w2, women1, women2, men1, men2 }: TeamInput) =>
      ({ name, m1, m2, w1, w2, women1, women2, men1, men2 });
    expect(copiedTeams.sort((a, b) => a.slot - b.slot).map(lineup)).toEqual(teamsOf(roster).map(lineup));
    expect((await db().select().from(signups).where(eq(signups.sessionId, whole))).every((s) => s.state === "in")).toBe(true);

    // One player unticked: the players still copy, the teams don't.
    const partial = await create({ ...base, invite: copy!.players!.slice(1), copyFrom: mlpSource });
    expect(await db().select().from(mlpTeams).where(eq(mlpTeams.sessionId, partial))).toHaveLength(0);
    expect(await db().select().from(signups).where(eq(signups.sessionId, partial))).toHaveLength(15);

    // Fixed pairs; the eleventh player is past capacity and queues.
    const fixedSource = await newSession({ format: "fixed", maxPlayers: 10, status: "closed" }, roster.slice(0, 10));
    for (let i = 0; i < 10; i += 2) {
      await db().update(signups).set({ partnerId: roster[i + 1] }).where(and(eq(signups.sessionId, fixedSource), eq(signups.playerId, roster[i])));
      await db().update(signups).set({ partnerId: roster[i] }).where(and(eq(signups.sessionId, fixedSource), eq(signups.playerId, roster[i + 1])));
    }
    const fixedCopy = await loadCopySource(actor, fixedSource, true);
    expect(fixedCopy?.pairs).toHaveLength(5);
    const paired = await create({ title: "Copied pairs", startsAt: new Date().toISOString(), courtNames: "1, 2", format: "fixed",
      maxPlayers: "9", invite: [...fixedCopy!.players!, roster[10]], copyFrom: fixedSource });
    const rows = await db().select().from(signups).where(eq(signups.sessionId, paired));
    const partnerOf = new Map(rows.map((r) => [r.playerId, r.partnerId]));
    for (let i = 0; i < 8; i += 2) expect(partnerOf.get(roster[i])).toBe(roster[i + 1]);
    // The fifth pair's second player is tenth, past a capacity of nine: unpaired, waitlisted.
    expect(partnerOf.get(roster[8])).toBeNull();
    expect(rows.filter((r) => r.state === "waitlist").map((r) => r.playerId).sort()).toEqual([roster[9], roster[10]].sort());

    // A private source is invisible to an admin who wasn't in it: nothing copies.
    await db().update(sessions).set({ isPrivate: true }).where(eq(sessions.id, mlpSource));
    actor = { id: otherAdmin, role: "admin" };
    expect(await loadCopySource(actor, mlpSource, true)).toBeNull();
    const blind = await create({ ...base, invite: copy!.players!, copyFrom: mlpSource });
    expect(await db().select().from(mlpTeams).where(eq(mlpTeams.sessionId, blind))).toHaveLength(0);
    actor = { id: organizer, role: "admin" };
  }, 180000);
});
