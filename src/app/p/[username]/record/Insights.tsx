import type { DictKey } from "@/lib/i18n/dictionaries/en";
import type { T } from "@/lib/i18n/translate";
import {
  byFormat,
  closeGames,
  form,
  strengthSplit,
  verdict,
  type InsightMatch,
  type Line,
  type Verdict,
} from "@/lib/profile/insights";

const pct = (x: number) => Math.round(x * 100);

const VERDICT_STYLE: Record<Verdict, string> = {
  above: "bg-[var(--success)] text-white",
  below: "bg-[var(--danger)] text-white",
  about: "bg-[var(--surface-2)] text-[var(--muted)]",
};

/**
 * How someone plays, from their record — the four sections the data supports.
 *
 * Straight reporting, no encouragement and no spin: the numbers and a one-word
 * call on each. Every section hides itself below the sample size where it would
 * be noise, and the whole card hides if nothing qualifies, so a new player sees
 * nothing rather than a page of confident guesses.
 */
export default function Insights({
  matches,
  isMe,
  t,
}: {
  matches: InsightMatch[];
  isMe: boolean;
  t: T;
}) {
  const strength = strengthSplit(matches);
  const recent = form(matches);
  const formats = byFormat(matches);
  const close = closeGames(matches);

  if (!strength && !recent && !formats && !close) return null;

  return (
    <section className="card mt-5">
      <h2 className="text-sm font-medium text-[var(--muted)]">
        {isMe ? t("insights.title") : t("insights.titleOther")}
      </h2>

      {strength ? (
        <Block title={t("insights.strength")}>
          {(
            [
              ["insights.stronger", strength.stronger],
              ["insights.even", strength.even],
              ["insights.weaker", strength.weaker],
            ] as const
          ).map(([label, line]) =>
            line ? <Row key={label} label={t(label)} line={line} t={t} /> : null,
          )}
          <p className="hint">{t("insights.strengthHint")}</p>
        </Block>
      ) : null}

      {recent ? (
        <Block title={t("insights.form")}>
          <SimpleRow
            label={t("insights.recent", { count: recent.recent.games })}
            record={recent.recent}
            t={t}
          />
          <SimpleRow label={t("insights.earlier")} record={recent.earlier} t={t} />
          <p className="mt-1 text-sm">{t(`insights.trend.${recent.trend}`)}</p>
        </Block>
      ) : null}

      {formats ? (
        <Block title={t("insights.format")}>
          {formats.map(({ format, line }) => (
            <Row
              key={format}
              label={t(`format.short.${format}` as DictKey)}
              line={line}
              t={t}
            />
          ))}
        </Block>
      ) : null}

      {close ? (
        <Block title={t("insights.close")}>
          <p className="text-sm">
            {t("insights.closeLine", {
              wins: close.wins,
              losses: close.games - close.wins,
              rate: pct(close.wins / close.games),
              overall: pct(close.overall),
            })}
          </p>
          <p className="mt-1 text-sm">
            {t(
              close.wins / close.games - close.overall >= 0.1
                ? "insights.close.better"
                : close.wins / close.games - close.overall <= -0.1
                  ? "insights.close.worse"
                  : "insights.close.same",
            )}
          </p>
        </Block>
      ) : null}
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-[var(--border)] pt-3 first-of-type:mt-3 first-of-type:border-0 first-of-type:pt-0">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

/** A group judged against what the ratings predicted. */
function Row({ label, line, t }: { label: string; line: Line; t: T }) {
  const v = verdict(line);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm">{label}</span>
        <span className="shrink-0 text-sm tabular-nums">
          <span className="font-semibold text-[var(--accent)]">{line.wins}</span>
          <span className="text-[var(--muted)]">–{line.games - line.wins}</span>
        </span>
      </div>
      {line.rated && v ? (
        <div className="mt-0.5 flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--muted)] tabular-nums">
            {t("insights.pointsVsPredicted", {
              actual: pct(line.rated.actual),
              expected: pct(line.rated.expected),
            })}
          </span>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${VERDICT_STYLE[v]}`}
          >
            {t(`insights.verdict.${v}`)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** A plain record: W–L and share of points, no expectation. */
function SimpleRow({ label, record, t }: { label: string; record: Line; t: T }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm">{label}</span>
      <span className="shrink-0 text-sm tabular-nums">
        <span className="font-semibold text-[var(--accent)]">{record.wins}</span>
        <span className="text-[var(--muted)]">–{record.games - record.wins}</span>
        <span className="ml-2 text-xs text-[var(--muted)]">
          {t("insights.pointsShare", { share: pct(record.share) })}
        </span>
      </span>
    </div>
  );
}
