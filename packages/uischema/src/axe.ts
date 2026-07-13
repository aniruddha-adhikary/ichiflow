import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core"), "utf8");

export interface AxeViolationLite {
  ruleId: string;
  impact: string;
}

interface AxeResult {
  violations: { id: string; impact?: string | null }[];
}

interface AxeApi {
  run(context: unknown, options: unknown): Promise<AxeResult>;
}

// WCAG 2.2 AA rule tags (doc 07 §12). `color-contrast` is deliberately disabled here — jsdom does no
// layout so it cannot compute rendered contrast; that gate is enforced separately over the design
// tokens (contrast.ts), exactly as the task splits axe (structure) from token-contract contrast.
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Run axe-core (WCAG 2.2 AA) over a rendered story document inside jsdom and return the AA violations.
 * Deterministic: no network, no wall-clock in the returned data (axe's own timestamp is discarded — we
 * keep only stable `{ ruleId, impact }`), same DOM ⇒ same result.
 */
export async function runAxeAA(html: string): Promise<AxeViolationLite[]> {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window as unknown as {
    eval: (src: string) => void;
    matchMedia?: unknown;
    document: unknown;
    axe?: AxeApi;
  };
  if (!win.matchMedia) {
    win.matchMedia = () => ({
      matches: false,
      media: "",
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });
  }
  win.eval(axeSource);
  const axe = win.axe;
  if (!axe) throw new Error("axe-core failed to initialize in jsdom");
  const results = await axe.run(win.document, {
    runOnly: { type: "tag", values: AA_TAGS },
    rules: { "color-contrast": { enabled: false } },
    resultTypes: ["violations"],
  });
  dom.window.close();
  return results.violations
    .map((v) => ({ ruleId: v.id, impact: v.impact ?? "unknown" }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}
