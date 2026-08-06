import { describe, expect, it } from "vitest";
import { isLocale, LOCALE_NAMES, LOCALES, localeFromHeader } from "./config";

describe("guessing a language from Accept-Language", () => {
  it("reads the region to choose the script", () => {
    // The distinction people actually notice: mainland and Singapore write
    // Simplified, Taiwan/Hong Kong/Macau write Traditional.
    expect(localeFromHeader("zh-CN,zh;q=0.9")).toBe("zh-Hans");
    expect(localeFromHeader("zh-SG")).toBe("zh-Hans");
    expect(localeFromHeader("zh-TW,zh;q=0.9")).toBe("zh-Hant");
    expect(localeFromHeader("zh-HK")).toBe("zh-Hant");
    expect(localeFromHeader("zh-MO")).toBe("zh-Hant");
    expect(localeFromHeader("zh-Hant-TW")).toBe("zh-Hant");
  });

  it("defaults bare Chinese to Simplified", () => {
    expect(localeFromHeader("zh")).toBe("zh-Hans");
  });

  it("takes the first tag it understands, not the first tag", () => {
    // A French speaker who also lists Chinese should get Chinese rather than
    // falling through to English.
    expect(localeFromHeader("fr-FR,fr;q=0.9,zh-TW;q=0.8")).toBe("zh-Hant");
    expect(localeFromHeader("de,en-GB;q=0.8")).toBe("en");
  });

  it("says nothing when it has nothing to go on", () => {
    // null, not a default: the caller decides, and only after the cookie and
    // the account have both had their say.
    expect(localeFromHeader(null)).toBeNull();
    expect(localeFromHeader("")).toBeNull();
    expect(localeFromHeader("fr-FR,fr;q=0.9")).toBeNull();
  });

  it("ignores case and stray whitespace", () => {
    expect(localeFromHeader("  ZH-tw ;q=0.9")).toBe("zh-Hant");
    expect(localeFromHeader("EN-US")).toBe("en");
  });
});

describe("the locale list", () => {
  it("accepts exactly the languages that have a dictionary", () => {
    for (const l of LOCALES) expect(isLocale(l)).toBe(true);
    // Guards the cookie and the server action, both of which take user input.
    for (const bad of ["", "zh", "en-US", "de", null, undefined, 7, {}]) {
      expect(isLocale(bad), String(bad)).toBe(false);
    }
  });

  it("names every language in its own script", () => {
    for (const l of LOCALES) expect(LOCALE_NAMES[l]).toBeTruthy();
    expect(LOCALE_NAMES["zh-Hans"]).not.toBe(LOCALE_NAMES["zh-Hant"]);
  });
});
