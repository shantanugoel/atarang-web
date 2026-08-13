/**
 * The one rule every user-facing failure in this app has to follow: say what
 * happened, and never repeat a thrown message verbatim.
 *
 * Internally, failures travel as short snake_case codes — `quota_exceeded`,
 * `recording_device_lost` — which are exactly right for a worker boundary and
 * exactly wrong on screen. Rendering `error.message` was how users were shown
 * "backup_integrity_failed", and, when something threw that was not one of our
 * codes at all, "Unexpected token '<'…" from a JSON parser.
 *
 * Each caller brings its own dictionary because the same code means different
 * things in different places: `quota_exceeded` while importing a song, while
 * installing a model and while restoring a backup need three different
 * sentences about three different things to delete.
 *
 * An unrecognised code is named in parentheses after the fallback, matching
 * what the model and local-separation mappers already do — it is a token worth
 * quoting in a bug report. Anything that is not code-shaped is a stack trace,
 * a parser complaint or a browser API message, and is dropped.
 */
const CODE = /^[a-z][a-z0-9_]*$/;

/** The code a caught value carries, or `fallback` when it carries none of ours. */
export function errorCode(value: unknown, fallback: string) {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  return CODE.test(message) ? message : fallback;
}

export function userMessage(value: unknown, messages: Record<string, string>, fallback: string) {
  const code = errorCode(value, "");
  return messages[code] ?? (code ? `${fallback} (${code})` : fallback);
}
