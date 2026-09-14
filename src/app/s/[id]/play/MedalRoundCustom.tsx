"use client";

import { useMemo, useState, useTransition } from "react";
import Avatar from "@/components/Avatar";
import { useT } from "@/lib/i18n/client";
import { createCustomMedalRoundAction } from "@/lib/sessions/play-actions";

export interface MedalTeam {
  /** Both player ids, sorted — the same key the standings use. */
  key: string;
  players: Array<{ id: string; username: string; avatar: string | null }>;
  /** Position in the team table, 1-based. */
  rank: number | null;
}

/**
 * Draw a medal round by hand.
 *
 * The automatic bracket seeds 1v4 and 2v3, which is the right default and not
 * always what the night calls for. This lets the organizer pick the two matchups
 * instead — at the semi-final stage, or again for gold and bronze.
 *
 * Teams are the unit here, not players. In a fixed-partner session splitting a
 * pair is not a choice the organizer should be able to express, so the picker
 * only offers whole teams and the invalid state simply cannot be built.
 */
export default function MedalRoundCustom({
  sessionId,
  stage,
  teams,
}: {
  sessionId: string;
  stage: "semifinal" | "final";
  teams: MedalTeam[];
}) {
  const t = useT();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);

  // Four slots: two matches of two teams.
  const [slots, setSlots] = useState<(string | null)[]>([null, null, null, null]);
  const [active, setActive] = useState(0);

  const byKey = useMemo(() => new Map(teams.map((x) => [x.key, x])), [teams]);
  const used = useMemo(
    () => new Set(slots.filter((s): s is string => s !== null)),
    [slots],
  );

  if (teams.length < 4) return null;

  const titles =
    stage === "semifinal"
      ? [t("play.medalSemi1"), t("play.medalSemi2")]
      : [t("play.medalGold"), t("play.medalBronze")];

  const put = (key: string) => {
    setSlots((prev) => {
      if (prev.includes(key)) return prev;
      const next = [...prev];
      const at = next[active] === null ? active : next.findIndex((s) => s === null);
      if (at === -1) return prev;
      next[at] = key;
      const gap = next.findIndex((s) => s === null);
      setActive(gap === -1 ? at : gap);
      return next;
    });
    setArmed(false);
  };

  const tapSlot = (index: number) => {
    setSlots((prev) => {
      if (prev[index] === null) return prev;
      const next = [...prev];
      next[index] = null;
      return next;
    });
    setActive(index);
    setArmed(false);
  };

  const reset = () => {
    setSlots([null, null, null, null]);
    setActive(0);
    setArmed(false);
  };

  const ready = slots.every((s) => s !== null);

  const submit = () => {
    if (!ready) return;
    const pairings = [0, 2].map((base) => {
      const a = byKey.get(slots[base] as string)!;
      const b = byKey.get(slots[base + 1] as string)!;
      return [a.players[0].id, a.players[1].id, b.players[0].id, b.players[1].id] as [
        string,
        string,
        string,
        string,
      ];
    });
    start(async () => {
      await createCustomMedalRoundAction(sessionId, stage, pairings);
      reset();
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-semibold"
        >
          {t(stage === "semifinal" ? "play.medalCustom" : "play.finalsCustom")}
        </button>
        <p className="hint">
          {t(stage === "semifinal" ? "play.medalCustomHint" : "play.finalsCustomHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <p className="hint mb-2">{t("play.medalPickSemis")}</p>

      <div className="flex flex-col gap-2">
        {[0, 2].map((base, i) => (
          <div key={base} className="rounded-xl border border-[var(--border)] p-2.5">
            <p className="mb-1.5 text-[11px] font-semibold text-[var(--muted)]">{titles[i]}</p>
            <div className="flex flex-col gap-1">
              {[base, base + 1].map((index) => (
                <Slot
                  key={index}
                  team={slots[index] ? byKey.get(slots[index] as string) : undefined}
                  activeNow={index === active && slots[index] === null}
                  onTap={() => tapSlot(index)}
                  empty={t("play.medalTeamEmpty")}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2">
        {teams.map((x) => {
          const taken = used.has(x.key);
          return (
            <button
              key={x.key}
              type="button"
              disabled={taken || pending}
              onClick={() => put(x.key)}
              className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left
                ${taken ? "border-[var(--border)] opacity-35" : "border-[var(--border)] active:bg-[var(--surface-2)]"}`}
            >
              {x.rank !== null ? (
                <span className="w-6 shrink-0 text-center text-xs tabular-nums text-[var(--muted)]">
                  {t("play.manualRank", { rank: x.rank })}
                </span>
              ) : null}
              <span className="flex shrink-0 -space-x-2">
                {x.players.map((p) => (
                  <span key={p.id} className="rounded-full ring-2 ring-[var(--surface)]">
                    <Avatar username={p.username} avatar={p.avatar} size={22} />
                  </span>
                ))}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {x.players.map((p) => p.username).join(" + ")}
              </span>
            </button>
          );
        })}
      </div>

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
              ? t("play.manualAdd")
              : t(stage === "semifinal" ? "play.medalCustom" : "play.finalsCustom")}
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

function Slot({
  team,
  activeNow,
  onTap,
  empty,
}: {
  team?: MedalTeam;
  activeNow: boolean;
  onTap: () => void;
  empty: string;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm
        ${
          team
            ? "bg-[var(--surface-2)]"
            : activeNow
              ? "border-2 border-[var(--accent)] bg-[var(--accent-soft)]"
              : "border border-dashed border-[var(--border)]"
        }`}
    >
      {team ? (
        <>
          <span className="flex shrink-0 -space-x-2">
            {team.players.map((p) => (
              <span key={p.id} className="rounded-full ring-2 ring-[var(--surface)]">
                <Avatar username={p.username} avatar={p.avatar} size={20} />
              </span>
            ))}
          </span>
          <span className="min-w-0 truncate">
            {team.players.map((p) => p.username).join(" + ")}
          </span>
        </>
      ) : (
        <span className="truncate text-[11px] text-[var(--muted)]">{empty}</span>
      )}
    </button>
  );
}
