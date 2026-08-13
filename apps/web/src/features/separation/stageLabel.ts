import { userMessage } from "../../app/errorText";

// Pipeline stage names are for logs. These are for the person watching a
// progress bar wondering whether anything is wrong. The server can send stages
// this list has not seen, so unknown ones degrade to readable words.
const STAGE_LABELS: Record<string, string> = {
  preflight: "Checking storage",
  loading_model: "Loading the model",
  separating: "Separating the four stems",
  packaging: "Verifying the result",
  publishing: "Saving to your library",
  creating: "Starting the job",
  uploading: "Uploading audio",
  importing_source: "Importing to your library",
};

export const stageLabel = (stage: string) => STAGE_LABELS[stage] ?? stage.replaceAll("_", " ");

const CLOUD_ERRORS: Record<string, string> = {
  invalid_deployment_key: "The deployment key was rejected. Check the DEPLOYMENT_KEY configured on that server.",
  invalid_source: "The audio for this song could not be read from browser storage, so nothing was uploaded.",
  result_integrity_failed: "The finished stems did not match their checksums, so nothing was imported.",
  failed: "The server could not finish this job. Nothing was imported.",
  cancelled: "The job was cancelled on the server. Nothing was imported.",
  expired: "The result expired on the server before it could be imported. Start the job again.",
  // The download succeeds and then the local import fails. Blaming the server
  // for these sends the user to check a machine that did nothing wrong.
  quota_exceeded: "There is not enough browser storage for four lossless stems. Free some space and run the separation again.",
  invalid_manifest: "The finished result did not describe four usable stems, so nothing was imported.",
  storage_unavailable: "Browser storage was unavailable while saving the stems. Nothing was imported.",
};

/**
 * Turns whatever the cloud path threw into a sentence.
 *
 * Callers used to render `error.message` directly, which is how users were
 * shown "Unexpected token '<'…" — a JSON parser complaining that an HTML error
 * page was not JSON. Anything unrecognised is described, never quoted, unless
 * it reads like a code the server actually sent.
 */
export function cloudErrorMessage(value: unknown) {
  // The two the browser itself throws, and the two most common failures: a
  // `fetch` that never connected, and an address that answered with something
  // other than the API — a login page, a CDN 404 page, the wrong site.
  if (value instanceof TypeError) return "Could not reach that server. Check the address, and that the server is running and reachable from this browser.";
  if (value instanceof SyntaxError) return "That address answered, but not as an Atarang server. Check the server origin in Settings.";
  const code = value instanceof Error ? value.message : String(value);
  const status = /^http_(\d+)$/.exec(code)?.[1];
  if (status) return status === "404" ? "Nothing answered at that address (404). Check the server origin in Settings."
    : status === "429" ? "The server is rate limiting requests. Wait a moment and try again."
    : Number(status) >= 500 ? `The server hit an internal error (${status}). Nothing was imported; try again shortly.`
    : `The server refused the request (${status}). Nothing was imported.`;
  // Unattributed on purpose: this catch also covers the local import that runs
  // after a download, so an unknown code is not necessarily the server's.
  return userMessage(value, CLOUD_ERRORS, "Cloud separation stopped. Nothing was imported or changed.");
}
