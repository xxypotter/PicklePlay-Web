"use client";

import { useMemo, useState, useTransition } from "react";
import Avatar from "@/components/Avatar";
import { useT } from "@/lib/i18n/client";
import { createManualRoundAction } from "@/lib/sessions/play-actions";

export interface ManualPlayer {
  id: string;
  username: string;
  avatar: string | null;
  /** Games already played tonight — the organizer needs it to be fair. */
  games: number;
  /** Position in the standings, or null before anyone has a result. */
  rank: number | null;
}

/**
 * Build a round by choosing the matchups.
 *
 * The random draw is right almost always, and wrong exactly when somebody has a
 * plan: six rounds of fixed partners are over and the organizer wants first
 * against second, third against fourth. No amount of shuffling produces that,
 * so this exists alongside the draw rather than replacing it.
 *
 * The interaction is "tap a player, they drop into the highlighted slot", not a
 * dropdown per seat. Courtside on a phone, eight taps in reading order beats
 * eight select menus — and because the roster arrives in standings order, going
 * straight down the list *is* the placement round.
 */
export default function ManualRound({
  sessionId,
  courtNames,
  players,
  nextRoundIndex,
  orderedBy,
}: {
  sessionId: string;
  courtNames: string[];
  players: ManualPlayer[];
  nextRoundIndex: number;
  /** Which explanation to show above the roster. */
  orderedBy: "teams" | "standings" | "none";
}) {
  const t = useT();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);

  /*
   * Only as many courts as there are people to fill them. Offering a fourth
   * court to nine players invites a half-filled round that the server then
   * rejects, which is a worse way to learn the rule than not being shown it.
   */
  const courts = Math.min(courtNames.length, Math.floor(players.length / 4));
  const seatCount = courts * 4;

  const [seats, setSeats] = useState<(string | null)[]>(() =>
    Array<string | null>(seatCount).fill(null),
  );
  const [active, setActive] = useState(0);

  const placed = useMemo(
    () => new Set(seats.filter((s): s is string => s !== null)),
    [seats],
  );
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  if (courts < 1) return null;

  const put = (playerId: string) => {
    setSeats((prev) => {
      if (prev.includes(playerId)) return prev;
      const next = [...prev];
      const at = next[active] === null ? active : next.findIndex((s) => s === null);
      if (at === -1) return prev;
      next[at] = playerId;
      // Advance to the next gap so a run of taps fills the card in order.
      const gap = next.findIndex((s) => s === null);
      setActive(gap === -1 ? at : gap);
      return next;
    });
  };

  const tapSeat = (index: number) => {
    setSeats((prev) => {
      if (prev[index] === null) return prev;
      const next = [...prev];
      next[index] = null;
      return next;
    });
    setActive(index);
    setArmed(false);
  };

  const reset = () => {
    setSeats(Array<string | null>(seatCount).fill(null));
    setActive(0);
    setArmed(false);
  };

  // A court is four players or none. Anything between is the one mistake this
  // interface makes easy, so it is named rather than silently dropped.
  const courtSeats = (court: number) => seats.slice(court * 4, court * 4 + 4);
  const filledCourts = Array.from({ length: courts }, (_, c) => courtSeats(c)).filter(
    (group) => group.every((s) => s !== null),
  );
  const partial = Array.from({ length: courts }, (_, c) => courtSeats(c)).some(
    (group) => group.some((s) => s !== null) && group.some((s) => s === null),
  );
  const ready = filledCourts.length > 0 && !partial;

  const sittingOut = players.filter((p) => !placed.has(p.id));

  const submit = () => {
    if (!ready) return;
    const pairings = filledCourts.map(
      (group) => group as [string, string, string, string],
    );
    start(async () => {
      await createManualRoundAction(sessionId, pairings);
      reset();
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-semibold"
        >
          {t("play.manual")}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <p className="hint mb-2">{t("play.manualTapSeat")}</p>

      <div className="flex flex-col gap-2">
        {Array.from({ length: courts }, (_, court) => (
          <div key={court} className="rounded-xl border border-[var(--border)] p-2.5">
            <p className="mb-1.5 text-[11px] font-semibold text-[var(--muted)]">
              {courtNames[court]}
            </p>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
              <Side
                seats={seats}
                base={court * 4}
                active={active}
                byId={byId}
                onTap={tapSeat}
                label={t("play.manualTeamA")}
                empty={t("play.manualEmpty")}
              />
              <span className="text-xs text-[var(--muted)]">{t("schedule.vs")}</span>
              <Side
                seats={seats}
                base={court * 4 + 2}
                active={active}
                byId={byId}
                onTap={tapSeat}
                label={t("play.manualTeamB")}
                empty={t("play.manualEmpty")}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="hint mt-2">
        {orderedBy === "teams"
          ? t("play.manualOrderTeams")
          : orderedBy === "standings"
            ? t("play.manualOrderStandings")
            : t("play.manualOrderPlain")}
      </p>

      <div className="mt-1 grid grid-cols-2 gap-2">
        {players.map((p) => {
          const used = placed.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              disabled={used || pending}
              onClick={() => {
                put(p.id);
                setArmed(false);
              }}
              className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left
                ${
                  used
                    ? "border-[var(--border)] opacity-35"
                    : "border-[var(--border)] active:bg-[var(--surface-2)]"
                }`}
            >
              <Avatar username={p.username} avatar={p.avatar} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{p.username}</span>
                <span className="block text-[10px] text-[var(--muted)]">
                  {p.rank !== null ? `${t("play.manualRank", { rank: p.rank })} · ` : ""}
                  {t("play.manualGames", { count: p.games })}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {sittingOut.length > 0 && ready ? (
        <p className="hint mt-2">
          {t("play.manualSitOut", { names: sittingOut.map((p) => p.username).join(", ") })}
        </p>
      ) : null}

      {partial ? <p className="hint mt-2">{t("play.manualPartial")}</p> : null}
      {!partial && filledCourts.length === 0 ? (
        <p className="hint mt-2">{t("play.manualNoneYet")}</p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="btn-ghost flex-1 text-sm disabled:opacity-50"
        >
          {t("play.manualClear")}
        </button>
        <button
          type="button"
          disabled={!ready || pending}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            submit();
          }}
          className={`flex-[2] rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-40 ${
            armed ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"
          }`}
        >
          {pending
            ? t("play.building")
            : armed
              ? t("play.manualAddConfirm", { index: nextRoundIndex })
              : t("play.manualAdd")}
        </button>
      </div>

      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(false);
        }}
        disabled={pending}
        className="mt-1 w-full text-xs font-semibold text-[var(--muted)] underline disabled:opacity-50"
      >
        {t("common.nevermind")}
      </button>
    </div>
  );
}

/** One team's two slots, stacked. */
function Side({
  seats,
  base,
  active,
  byId,
  onTap,
  label,
  empty,
}: {
  seats: (string | null)[];
  base: number;
  active: number;
  byId: Map<string, ManualPlayer>;
  onTap: (index: number) => void;
  label: string;
  empty: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="sr-only">{label}</span>
      {[base, base + 1].map((index) => {
        const id = seats[index];
        const person = id ? byId.get(id) : undefined;
        const isActive = index === active && !id;
        return (
          <button
            key={index}
            type="button"
            onClick={() => onTap(index)}
            aria-label={person ? person.username : empty}
            className={`flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-sm
              ${
                person
                  ? "bg-[var(--surface-2)]"
                  : isActive
                    ? "border-2 border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border border-dashed border-[var(--border)]"
              }`}
          >
            {person ? (
              <>
                <Avatar username={person.username} avatar={person.avatar} size={20} />
                <span className="min-w-0 truncate">{person.username}</span>
              </>
            ) : (
              <span className="truncate text-[11px] text-[var(--muted)]">{empty}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
