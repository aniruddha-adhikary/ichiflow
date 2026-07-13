import { CONTRAST_PAIRS, type ContrastPair } from "./tokens.js";

export interface ContrastResult {
  token: string;
  kind: "text" | "ui";
  ratio: number;
  min: number;
  pass: boolean;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a `#rrggbb` hex color. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) throw new Error(`invalid hex color: ${hex}`);
  const int = parseInt(m[1]!, 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two hex colors, rounded to 2 dp (deterministic). */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  const ratio = (hi + 0.05) / (lo + 0.05);
  return Math.round(ratio * 100) / 100;
}

/** The minimum ratio a pair must meet per WCAG 2.2 (text 4.5:1, UI component 3:1). */
export function minRatio(kind: ContrastPair["kind"]): number {
  return kind === "text" ? 4.5 : 3;
}

/** Evaluate the token-contract contrast gate over the semantic token pairs (doc 07 §12). */
export function checkContrast(pairs: ContrastPair[] = CONTRAST_PAIRS): ContrastResult[] {
  return pairs.map((p) => {
    const ratio = contrastRatio(p.fg, p.bg);
    const min = minRatio(p.kind);
    return { token: p.token, kind: p.kind, ratio, min, pass: ratio >= min };
  });
}
