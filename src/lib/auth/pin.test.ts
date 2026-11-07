import { describe, expect, it } from "vitest";
import { hashPin, validatePin, validatePinDigits, verifyPin } from "./pin";

describe("PIN hashing", () => {
  it("verifies the PIN it hashed and nothing else", async () => {
    const stored = await hashPin("1111");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPin("1111", stored)).toBe(true);
    expect(await verifyPin("1112", stored)).toBe(false);
    expect(await verifyPin("", stored)).toBe(false);
  });

  it("treats full-width digits as the same PIN, so a Chinese keyboard still signs in", async () => {
    const stored = await hashPin("1111");
    expect(await verifyPin("１１１１", stored)).toBe(true);
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    expect(await verifyPin("1111", "")).toBe(false);
    expect(await verifyPin("1111", "bcrypt$x$y")).toBe(false);
    expect(await verifyPin("1111", "scrypt$16384$8$1$$")).toBe(false);
  });
});

describe("PIN rules", () => {
  it("a player choosing their own PIN may not pick a guessable one", () => {
    expect(validatePin("1357")).toEqual({ ok: true });
    expect(validatePin("1111")).toEqual({ ok: false, error: "err.pinGuessable" });
    expect(validatePin("1234")).toEqual({ ok: false, error: "err.pinGuessable" });
    expect(validatePin("4321")).toEqual({ ok: false, error: "err.pinGuessable" });
    expect(validatePin("12")).toEqual({ ok: false, error: "err.pinDigits" });
    expect(validatePin("12a4")).toEqual({ ok: false, error: "err.pinDigits" });
  });

  it("an admin's temporary PIN only has to be 4–6 digits (v2.2)", () => {
    // The admin hands it over in person and the player is meant to change it;
    // refusing 1111 here is what left a player with a PIN that was never saved.
    expect(validatePinDigits("1111")).toEqual({ ok: true });
    expect(validatePinDigits("123456")).toEqual({ ok: true });
    expect(validatePinDigits("123")).toEqual({ ok: false, error: "err.pinDigits" });
    expect(validatePinDigits("1234567")).toEqual({ ok: false, error: "err.pinDigits" });
    expect(validatePinDigits("11 11")).toEqual({ ok: false, error: "err.pinDigits" });
  });
});
