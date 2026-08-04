import Link from "next/link";

/**
 * The app-name header from the mini-program: title dead centre, optional back
 * chevron on the left, nothing else competing with it.
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
            className="absolute left-2 flex size-9 items-center justify-center text-xl"
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
