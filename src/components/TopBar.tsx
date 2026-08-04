import Link from "next/link";

/** Only same-site paths; a `from` value off a URL is otherwise a redirect hole. */
export function safeFrom(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return /^\/(?!\/)[\w\-./?=&%]*$/.test(value) ? value : fallback;
}

/**
 * The app-name header from the mini-program: title dead centre, optional back
 * chevron on the left, nothing else competing with it.
 *
 * `back` is a real destination rather than a call to history.back(). Pages like
 * the profile are reachable from several places, so the linking page passes
 * `?from=` and the target reads it — see safeFrom. Using browser history looked
 * tempting but sends someone off the site entirely when the page was opened
 * from a shared link, which is exactly the entry point most likely to be
 * someone's first visit.
 */
export default function TopBar({
  title = "PicklePlay",
  back,
  action,
}: {
  title?: string;
  back?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 bg-[var(--surface)]">
      <div className="relative mx-auto flex h-12 w-full max-w-md items-center justify-center px-4">
        {back ? (
          <Link
            href={back}
            aria-label="Back"
            className="absolute left-2 flex size-9 items-center justify-center text-xl
              active:opacity-60"
          >
            ‹
          </Link>
        ) : null}
        <h1 className="truncate text-base font-semibold">{title}</h1>
        {action ? <div className="absolute right-3">{action}</div> : null}
      </div>
    </header>
  );
}
