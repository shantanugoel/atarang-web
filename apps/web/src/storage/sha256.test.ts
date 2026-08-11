import { describe, expect, test } from "bun:test";
import { IncrementalSha256 } from "./sha256";

describe("IncrementalSha256", () => {
  test("matches the standard empty and abc vectors", () => {
    expect(new IncrementalSha256().digestHex()).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(new IncrementalSha256().update(new TextEncoder().encode("abc")).digestHex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  test("is chunk-boundary independent", () => {
    const hash = new IncrementalSha256();
    for (const value of ["a", "b", "c"]) hash.update(new TextEncoder().encode(value));
    expect(hash.digestHex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
