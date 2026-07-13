/**
 * jsdom bootstrap. The Portal harness renders real React under a DOM; under Vitest a `jsdom`
 * environment is already present, so we reuse it, and under the `portal:preview` producer (plain
 * Node) we construct one. Either way the render path is identical — headless, deterministic.
 */
export async function ensureDom(): Promise<void> {
  const g = globalThis as { document?: unknown; window?: unknown; navigator?: unknown };
  if (g.document) return;

  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://portal.ichiflow.test/",
  });
  g.window = dom.window;
  g.document = dom.window.document;
  if (!g.navigator) g.navigator = dom.window.navigator;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
}
