import { afterEach, describe, expect, test } from "bun:test";
import { detectCloudOrigin } from "./cloudAvailability";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const answerWith = (byOrigin: Record<string, Response>) => {
  globalThis.fetch = ((input: string | URL | Request) => {
    const { origin } = new URL(String(input));
    const response = byOrigin[origin];
    // No entry means nothing is listening there: a transport failure, which is
    // how fetch reports no DNS, no route and no CORS alike.
    return response ? Promise.resolve(response.clone()) : Promise.reject(new TypeError("Failed to fetch"));
  }) as typeof fetch;
};

const unauthorized = () => new Response('{"error":{"code":"invalid_deployment_key"}}', { status: 401, headers: { "content-type": "application/json" } });
const spaShell = () => new Response("<!doctype html><title>Atarang</title>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

describe("cloud backend detection", () => {
  test("an unauthenticated 401 is a backend", async () => {
    answerWith({ "https://api.example.com": unauthorized() });
    expect(await detectCloudOrigin(["https://api.example.com"])).toBe("https://api.example.com");
  });

  test("the SPA shell is not a backend, whatever its status says", async () => {
    answerWith({ "https://app.example.com": spaShell() });
    expect(await detectCloudOrigin(["https://app.example.com"])).toBeNull();
  });

  test("a host that does not answer at all is not a backend", async () => {
    answerWith({});
    expect(await detectCloudOrigin(["https://lan.example.com"])).toBeNull();
  });

  test("the page's own origin wins when both answer", async () => {
    answerWith({ "https://app.example.com": unauthorized(), "https://api.example.com": unauthorized() });
    expect(await detectCloudOrigin(["https://app.example.com", "https://api.example.com"])).toBe("https://app.example.com");
  });

  test("falls through to the configured backend when the page's origin is static", async () => {
    answerWith({ "https://app.example.com": spaShell(), "https://api.example.com": unauthorized() });
    expect(await detectCloudOrigin(["https://app.example.com", "https://api.example.com"])).toBe("https://api.example.com");
  });

  test("an earlier answer settles it without waiting for a slower candidate", async () => {
    // The slow candidate never settles at all, so this test hangs and times out
    // if detection ever goes back to waiting for every probe before deciding.
    globalThis.fetch = ((input: string | URL | Request) =>
      new URL(String(input)).origin === "https://app.example.com" ? Promise.resolve(unauthorized()) : new Promise<Response>(() => {})) as typeof fetch;
    expect(await detectCloudOrigin(["https://app.example.com", "https://slow.example.com"])).toBe("https://app.example.com");
  });

  test("an unparseable candidate is skipped, not thrown", async () => {
    answerWith({ "https://api.example.com": unauthorized() });
    expect(await detectCloudOrigin(["not-an-address", "https://api.example.com"])).toBe("https://api.example.com");
  });
});
