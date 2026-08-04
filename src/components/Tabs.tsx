import Link from "next/link";

export interface TabItem {
  key: string;
  label: string;
  href: string;
  badge?: string;
}

/**
 * Top segmented tabs. Active is bold orange with no underline, matching the
 * mini-program — the weight and colour carry it, a rule underneath would just
 * add noise on a small screen.
 */
export default function Tabs({ items, active }: { items: TabItem[]; active: string }) {
  return (
    <nav className="sticky top-12 z-10 bg-[var(--surface)]">
      <div className="tabs mx-auto w-full max-w-md">
        {items.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`tab ${t.key === active ? "tab-active" : ""}`}
            aria-current={t.key === active ? "page" : undefined}
          >
            {t.label}
            {t.badge ? (
              <sup className="ml-1 text-[10px] font-semibold text-[var(--accent)]">
                {t.badge}
              </sup>
            ) : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
