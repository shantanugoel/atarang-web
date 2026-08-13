import { describe, expect, test } from "bun:test";
import { userMessage } from "./errorText";

const MESSAGES = { quota_exceeded: "There is not enough browser storage." };
const FALLBACK = "The operation stopped safely.";

describe("user-facing error text", () => {
  test("prefers the sentence written for the code", () =>
    expect(userMessage(new Error("quota_exceeded"), MESSAGES, FALLBACK)).toBe(MESSAGES.quota_exceeded));

  test("accepts a bare code string, not only an Error", () =>
    expect(userMessage("quota_exceeded", MESSAGES, FALLBACK)).toBe(MESSAGES.quota_exceeded));

  test("names an unmapped code after the fallback, for bug reports", () =>
    expect(userMessage(new Error("recording_device_lost"), MESSAGES, FALLBACK))
      .toBe(`${FALLBACK} (recording_device_lost)`));

  test("drops anything that is not one of our codes", () => {
    // The three shapes the QA pass caught on screen.
    for (const raw of [
      new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"),
      new TypeError("Failed to construct 'URL': Invalid URL"),
      new Error("Cannot read properties of undefined (reading 'length')"),
    ]) expect(userMessage(raw, MESSAGES, FALLBACK)).toBe(FALLBACK);
  });

  test("survives a thrown non-Error", () => {
    expect(userMessage(undefined, MESSAGES, FALLBACK)).toBe(FALLBACK);
    expect(userMessage({ code: 500 }, MESSAGES, FALLBACK)).toBe(FALLBACK);
  });
});
