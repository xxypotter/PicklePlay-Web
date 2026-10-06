"use client";

import { useState, useTransition } from "react";
import ConfirmAction from "@/components/mlp/ConfirmAction";
import { useT } from "@/lib/i18n/client";
import { drawSwissFinalsAction, drawSwissRoundAction, startSwissPlayoffsAction } from "@/lib/swiss/actions";
import { SWISS_MIN_ROUNDS_BEFORE_PLAYOFFS, suggestedRounds, validPairCount } from "@/lib/swiss/engine";
import type { SwissPhase } from "@/lib/swiss/view";

/**
 * The organizer's one place to move a Swiss night on: draw round 1 (seeded or
 * random), each next round once the last is scored, then the two playoff
 * waves. Each step says what it is waiting for rather than greying out.
 */
export default function SwissControls({
  sessionId,
  phase,
  open,
  roundsPlayed,
  max,
  pairsReady,
  unpaired,
}: {
  sessionId: string;
  phase: SwissPhase;
  /** The current stage still has games without a result. */
  open: boolean;
  roundsPlayed: number;
  max: number;
  /** Complete pairs: among the players here before round 1, then the pairs playing. */
  pairsReady: number;
  unpaired: number;
}) {
  const t = useT();
  const [pending, start] = useTransition();
  const [seeded, setSeeded] = useState(true);
  const [error, setError] = useState("");
  const run = (action: () => Promise<void>) =>
    start(async () => {
      setError("");
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });

  const suggested = suggestedRounds(pairsReady);
  const ready = unpaired === 0 && validPairCount(pairsReady);
  const nextLabel = t("swiss.drawNext", { n: roundsPlayed + 1 });
  // Once the suggested rounds are in, the playoffs become the main button.
  const playoffsFirst = roundsPlayed >= suggested;

  return (
    <div className="mt-1">
      <h2 className="font-semibold">{t("swiss.title")}</h2>

      {phase === "setup" ? (
        <>
          <p className="hint">
            {unpaired > 0
              ? t("swiss.unpaired", { count: unpaired })
              : t("swiss.pairsReady", { count: pairsReady })}
            {" "}
            {validPairCount(pairsReady) ? t("swiss.suggested", { n: suggestedRounds(pairsReady) }) : t("swiss.pairRange")}
          </p>
          <fieldset className="mt-3 grid gap-2" disabled={pending}>
            <legend className="label">{t("swiss.firstRound")}</legend>
            {([true, false] as const).map((value) => (
              <label key={String(value)} className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] p-3">
                <input
                  type="radio"
                  name="swiss-seeding"
                  className="mt-1 accent-[var(--accent)]"
                  checked={seeded === value}
                  onChange={() => setSeeded(value)}
                />
                <span>
                  <span className="text-sm font-medium">{t(value ? "swiss.seeded" : "swiss.random")}</span>
                  <span className="hint block">{t(value ? "swiss.seededHint" : "swiss.randomHint")}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <ConfirmAction
            label={t("swiss.drawNext", { n: 1 })}
            confirmation={t("swiss.drawFirstConfirm")}
            disabled={pending || !ready}
            onConfirm={() => run(() => drawSwissRoundAction(sessionId, seeded))}
          />
        </>
      ) : phase === "swiss" ? (
        <>
          <p className="hint">{t("swiss.progress", { n: roundsPlayed, total: suggested })}</p>
          {open ? (
            <p className="hint">{t("swiss.finishRound", { n: roundsPlayed })}</p>
          ) : (
            <div className={`flex gap-0 ${playoffsFirst ? "flex-col-reverse" : "flex-col"}`}>
              {roundsPlayed < max ? (
                <ConfirmAction
                  label={nextLabel}
                  confirmation={t("swiss.drawNextConfirm", { n: roundsPlayed + 1 })}
                  disabled={pending}
                  className={playoffsFirst ? "btn-ghost mt-2 w-full" : "btn-primary mt-2 w-full"}
                  onConfirm={() => run(() => drawSwissRoundAction(sessionId))}
                />
              ) : (
                <p className="hint">{t("swiss.noMoreRounds")}</p>
              )}
              {roundsPlayed >= SWISS_MIN_ROUNDS_BEFORE_PLAYOFFS ? (
                <ConfirmAction
                  label={t("swiss.startPlayoffs")}
                  confirmation={t("swiss.playoffsConfirm")}
                  disabled={pending}
                  className={playoffsFirst ? "btn-primary mt-2 w-full" : "btn-ghost mt-2 w-full"}
                  onConfirm={() => run(() => startSwissPlayoffsAction(sessionId))}
                />
              ) : null}
            </div>
          )}
          <p className="hint">{t("swiss.playoffsHint")}</p>
        </>
      ) : phase === "playoffs" ? (
        open ? (
          <p className="hint">{t("swiss.finishPlayoffs")}</p>
        ) : (
          <ConfirmAction
            label={t("swiss.drawFinals")}
            confirmation={t("swiss.drawFinalsConfirm")}
            disabled={pending}
            onConfirm={() => run(() => drawSwissFinalsAction(sessionId))}
          />
        )
      ) : (
        <p className="hint">{t(phase === "done" ? "swiss.done" : "swiss.finishFinals")}</p>
      )}

      {error ? <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
