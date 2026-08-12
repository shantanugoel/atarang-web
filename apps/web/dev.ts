import { watch } from "node:fs";
import { join } from "node:path";
import { serveDist } from "./server";

// `bun --hot src/index.html` cannot send COOP/COEP — Bun has no header option
// for HTML-bundle routes — so its dev server silently disables every stem
// feature. Rebuilding onto the same cross-origin-isolated server that preview
// uses costs a browser reload and keeps the app whole.
const build = () => {
  const result = Bun.spawnSync(["bun", "run", "build.ts"], { cwd: import.meta.dir, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) console.error("Build failed; serving the previous output.");
};

build();
const port = Number(Bun.env.PORT ?? 3000);
serveDist(port);
console.log(`Atarang dev listening on http://localhost:${port} — cross-origin isolated. Reload after a rebuild.`);

let pending: ReturnType<typeof setTimeout> | undefined;
watch(join(import.meta.dir, "src"), { recursive: true }, (_event, filename) => {
  // build.ts writes src/generated/*, which would otherwise retrigger forever.
  if (!filename || filename.startsWith("generated/")) return;
  clearTimeout(pending);
  pending = setTimeout(build, 120);
});
