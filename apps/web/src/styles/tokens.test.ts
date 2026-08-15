import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

const stylesDir = new URL(".", import.meta.url).pathname;
const srcDir = new URL("..", import.meta.url).pathname;
const tokensCss = await Bun.file(`${stylesDir}tokens.css`).text();

const moduleFiles = (await Array.fromAsync(new Glob("**/*.module.css").scan({ cwd: srcDir }))).sort();
const modules = await Promise.all(moduleFiles.map(async (path) => [path, await Bun.file(`${srcDir}${path}`).text()] as const));

// Comments are prose about colours as often as they are colours.
const withoutComments = (css: string) => css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)|(?<![\w-])(?:white|black)(?![\w-])/g;

// Asserted against the source rather than a rendered page because Playwright's
// reducedMotion emulation does not reach matchMedia in this setup — verified with
// a throwaway spec that read back no-preference under `use: {reducedMotion}`.
describe("motion preferences", () => {
  test("every animation slows and nothing slides when reduce is asked for", async () => {
    const globalCss = await Bun.file(`${stylesDir}global.css`).text();
    const reduced = globalCss.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    // Slowed rather than removed: a frozen spinner reads as a hung app.
    expect(reduced).toContain("animation-duration");
    expect(reduced).toContain("scroll-behavior: auto !important");
    // Blunt on purpose — the selector has to be everything, or the next module
    // CSS file to add an animation quietly ignores the preference.
    expect(reduced).toContain("*, *::before, *::after");
  });

  test("the view that scrolls itself asks the same question", async () => {
    const followScroll = await Bun.file(`${srcDir}features/studio/followScroll.tsx`).text();
    // scrollIntoView takes its behaviour as an argument, so CSS cannot reach it.
    expect(followScroll).toContain("prefers-reduced-motion: reduce");
    expect(followScroll).toMatch(/reduced \? "instant" : "smooth"/);
  });
});

describe("one palette, in one place", () => {
  test("no module CSS names a colour of its own", () => {
    const offenders = modules.flatMap(([path, css]) => [...withoutComments(css).matchAll(LITERAL)].map((match) => `${path}: ${match[0]}`));
    // A literal is a colour that works on exactly one ground. The light palette
    // exists because the OS asks for it, and a literal ignores the request.
    expect(offenders).toEqual([]);
  });

  test("every token a module reads is actually defined", () => {
    const defined = new Set([...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]!));
    // Set by the components that use them rather than globally: a channel's stem
    // colour, the focus ring, and the sing-along text scale, which is a slider.
    const local = new Set(["--stem", "--focus", "--sing-scale"]);
    const used = new Set(modules.flatMap(([, css]) => [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]!)));
    expect([...used].filter((token) => !defined.has(token) && !local.has(token))).toEqual([]);
  });

  test("the light palette redefines every colour role and no size", () => {
    const [, base = "", light = ""] = tokensCss.match(/:root \{([\s\S]*?)\}[\s\S]*?prefers-color-scheme: light\)[\s\S]*?:root \{([\s\S]*?)\}/) ?? [];
    const names = (block: string) => [...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()] as const);
    const baseColors = names(base).filter(([, value]) => /^#|^rgba?\(|^color-mix/.test(value)).map(([name]) => name);
    const lightNames = new Set(names(light).map(([name]) => name));
    // Text on the accent fill is white on both grounds, because the accent stays
    // purple. Everything else that is a colour has to say what it is on white —
    // a role defined only on the dark ground is a role that stays dark there.
    const sharedByDesign = new Set(["--on-accent"]);
    expect(baseColors.filter((name) => !lightNames.has(name) && !sharedByDesign.has(name))).toEqual([]);
    // And the light block is colours only: a duplicated size drifts silently.
    expect(names(light).filter(([, value]) => /px|rem|ms|s$/.test(value))).toEqual([]);
  });
});
