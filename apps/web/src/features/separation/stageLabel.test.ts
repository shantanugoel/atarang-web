import { describe, expect, test } from "bun:test";
import { cloudErrorMessage } from "./stageLabel";

describe("cloud error messages", () => {
  test("never repeats a raw exception message back to the user", () => {
    // The reported defect: a JSON parser complaining about an HTML error page.
    const parse = cloudErrorMessage(new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"));
    expect(parse).not.toContain("Unexpected token");
    expect(parse).not.toContain("JSON");
    expect(parse).toContain("not as an Atarang server");
    const offline = cloudErrorMessage(new TypeError("Failed to fetch"));
    expect(offline).not.toContain("fetch");
    expect(offline).toContain("Could not reach");
    // A server that answers wrongly and one that never answers are different
    // problems with different fixes, so they must not read the same.
    expect(offline).not.toBe(parse);
  });

  test("explains the codes the cloud path actually throws", () => {
    expect(cloudErrorMessage(new Error("invalid_deployment_key"))).toContain("DEPLOYMENT_KEY");
    expect(cloudErrorMessage(new Error("expired"))).toContain("expired");
    expect(cloudErrorMessage(new Error("http_404"))).toContain("404");
    expect(cloudErrorMessage(new Error("http_429"))).toContain("rate limiting");
    expect(cloudErrorMessage(new Error("http_503"))).toContain("503");
  });

  test("quotes a code it does not know, but only when it is a code", () => {
    expect(cloudErrorMessage(new Error("model_unavailable"))).toContain("model_unavailable");
    expect(cloudErrorMessage(new Error("Something exploded at line 4"))).not.toContain("exploded");
  });

  test("does not blame the server for the local import that follows a download", () => {
    // This mapper also formats what `importSeparationPackage` throws.
    expect(cloudErrorMessage(new Error("quota_exceeded"))).toContain("browser storage");
    expect(cloudErrorMessage(new Error("something_else"))).not.toContain("server");
  });
});
