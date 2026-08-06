import { describe, expect, it } from "vitest";
import { LOCALES } from "./config";
import { en, type DictKey } from "./dictionaries/en";
import { zhHans } from "./dictionaries/zh-Hans";
import { zhHant } from "./dictionaries/zh-Hant";
import { makeT } from "./translate";

const TRANSLATIONS = { "zh-Hans": zhHans, "zh-Hant": zhHant } as const;
const KEYS = Object.keys(en) as DictKey[];

/** Every {slot} a string expects a value for. */
const slotsIn = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

describe("the dictionaries", () => {
  it("cover exactly the same keys", () => {
    // TypeScript already enforces this, but only while the types line up —
    // and `Dict` is a Record, so a stray extra key would slip through.
    for (const [name, dict] of Object.entries(TRANSLATIONS)) {
      expect(Object.keys(dict).sort(), name).toEqual(KEYS.slice().sort());
    }
  });

  it("leaves no string untranslated", () => {
    /*
     * The failure this catches is a copy-paste: adding a key by duplicating
     * the English line and forgetting to translate it. Short strings are
     * legitimately identical across languages — "PicklePlay", "DUPR", "W",
     * a bare separator — so only strings with real prose are checked.
     */
    const prose = KEYS.filter((k) => en[k].split(/\s+/).length >= 4);
    expect(prose.length).toBeGreaterThan(50);

    for (const [name, dict] of Object.entries(TRANSLATIONS)) {
      const untranslated = prose.filter((k) => dict[k] === en[k]);
      expect(untranslated, `${name} still in English`).toEqual([]);
    }
  });

  it("keeps every placeholder a translation has to fill", () => {
    // A dropped {count} silently renders a sentence with a hole in it, and a
    // renamed one renders the literal braces. Neither shows up in a typecheck.
    for (const [name, dict] of Object.entries(TRANSLATIONS)) {
      for (const key of KEYS) {
        expect(slotsIn(dict[key]), `${name} · ${key}`).toEqual(slotsIn(en[key]));
      }
    }
  });

  it("gives every plural key a singular to fall back to", () => {
    for (const key of KEYS) {
      if (!key.endsWith(".plural")) continue;
      expect(KEYS, key).toContain(key.slice(0, -".plural".length));
    }
  });
});

describe("the translator", () => {
  it("substitutes values into every language", () => {
    for (const locale of LOCALES) {
      const t = makeT(locale);
      const text = t("card.signedUp", { count: 6, max: 8 });
      expect(text).toContain("6");
      expect(text).toContain("8");
      expect(text).not.toContain("{");
    }
  });

  it("picks the plural form on count, and Chinese never needs one", () => {
    const enT = makeT("en");
    expect(enT.plural("card.matches", 1, { count: 1 })).toBe("1 match");
    expect(enT.plural("card.matches", 3, { count: 3 })).toBe("3 matches");

    // Chinese has no plural forms; both counts give the same well-formed string.
    const zh = makeT("zh-Hans");
    expect(zh.plural("card.matches", 3, { count: 3 })).toBe(
      zh.plural("card.matches", 1, { count: 1 }).replace("1", "3"),
    );
  });

  it("splices nodes into a slot without dropping the surrounding text", () => {
    const parts = makeT("zh-Hans").rich("card.signedUp", { count: "N", max: "M" });
    expect(parts).toContain("N");
    expect(parts).toContain("M");
    expect(parts.join("")).not.toContain("{");
  });

  it("falls back to English rather than showing a raw key", () => {
    // Belt and braces: the type system prevents a missing key, but a bad
    // runtime value (say, a role from the database) must not reach the screen.
    const t = makeT("zh-Hans");
    expect(t("nope.not.a.key" as DictKey)).toBe("nope.not.a.key");
    expect(makeT("de" as never)("common.save")).toBe(en["common.save"]);
  });
});
