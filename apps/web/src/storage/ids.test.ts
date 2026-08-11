import { describe, expect, test } from "bun:test";
import { uuidV7 } from "./ids";

describe("uuidV7", () => {
  test("emits a version 7 RFC variant UUID", () => {
    expect(uuidV7(1_700_000_000_000)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
