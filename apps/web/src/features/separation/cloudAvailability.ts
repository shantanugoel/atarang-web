import { useEffect, useState } from "react";
import { backendOrigin } from "../../generated/cloud-config";

// Long enough for a LAN round trip, short enough that a hostname routing
// nowhere does not hold the cloud surfaces on "Checking…" while someone reads.
const PROBE_TIMEOUT_MS = 2_000;

// A running API answers /capabilities with 401, because the probe deliberately
// carries no deployment key. A static host answers the same path with the SPA
// shell — a 200 that means the opposite of what its status says — so the status
// alone cannot be trusted here.
async function answers(origin: string) {
  try {
    const response = await fetch(`${origin}/api/v1/capabilities`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return response.status === 401 || (response.headers.get("content-type") ?? "").includes("application/json");
  } catch { return false; }
}

/** The first candidate that turns out to be a backend, preferring earlier ones.
 *  Probed together, so an address that routes nowhere costs one timeout rather
 *  than one per candidate — and an earlier answer settles it without waiting
 *  for that timeout at all. */
export async function detectCloudOrigin(candidates: readonly string[]): Promise<string | null> {
  const unique = [...new Set(candidates.filter((candidate) => URL.canParse(candidate)).map((candidate) => new URL(candidate).origin))];
  const pending = unique.map(answers);
  for (const [index, probe] of pending.entries()) if (await probe) return unique[index]!;
  return null;
}

export const REPOSITORY = "https://github.com/shantanugoel/atarang-web";

export type CloudAvailability = "checking" | "found" | "none";

let detected: string | null = null;
let probe: Promise<CloudAvailability> | null = null;

/** The origin detection settled on, or null before it settles and when there is
 *  none. Read synchronously by getCloudConfiguration; the surfaces that care
 *  re-render through useCloudAvailability once the probe lands. */
export const detectedCloudOrigin = () => detected;

function cloudAvailability(): Promise<CloudAvailability> {
  probe ??= detectCloudOrigin([location.origin, backendOrigin].filter((origin) => origin !== ""))
    .then((origin) => { detected = origin; return origin ? "found" : "none"; });
  return probe;
}

export function useCloudAvailability(): CloudAvailability {
  const [state, setState] = useState<CloudAvailability>("checking");
  useEffect(() => {
    let active = true;
    void cloudAvailability().then((value) => { if (active) setState(value); });
    return () => { active = false; };
  }, []);
  return state;
}
