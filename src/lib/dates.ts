/**
 * Date helpers for the session forms.
 *
 * Plain module rather than living inside the field component, so the rules can
 * be tested directly — "the coming Saturday" has more edge cases than it looks
 * like it does.
 */

const SATURDAY = 6;
export const SESSION_START_HOUR = 18;

/** `datetime-local` wants a wall-clock string built from local parts. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * The group's usual slot: the coming Saturday at 6pm.
 *
 * On a Saturday it means *today*, right up until the slot starts — an organizer
 * setting up that morning wants today, not a week away. Once 6pm has passed
 * there is nothing left to organize today, so it rolls to next week.
 *
 * `now` is injectable so the tests can pin a weekday instead of depending on
 * the day they happen to run.
 */
export function comingSaturday(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);

  let days = (SATURDAY - d.getDay() + 7) % 7;
  if (days === 0 && d.getHours() >= SESSION_START_HOUR) days = 7;

  d.setDate(d.getDate() + days);
  d.setHours(SESSION_START_HOUR);
  return d;
}
