/**
 * The design-token contract slice the UI harness gates (doc 07 §11.1/§12). Tokens are the theming
 * spine; the token-contract contrast gate (doc 12 table) asserts every semantic text/UI pair meets
 * WCAG 2.2 (text ≥ 4.5:1, UI ≥ 3:1). Values are checked-in hex primitives referenced by semantic
 * roles — the DTCG shape in spirit, minimized to what the contrast check needs.
 */

export interface ContrastPair {
  /** Semantic token id (the check name). */
  token: string;
  /** Foreground hex. */
  fg: string;
  /** Background hex. */
  bg: string;
  /** `text` (≥4.5:1) or `ui` (≥3:1) per WCAG 2.2. */
  kind: "text" | "ui";
}

/** Primitive palette (hex), the base layer of the three-layer token structure (doc 07 §11.1). */
export const PRIMITIVES = {
  surface: "#ffffff",
  ink: "#1f2933",
  primary: "#0b5cad",
  onPrimary: "#ffffff",
  danger: "#b00020",
  border: "#6b7280",
  focus: "#0b5cad",
} as const;

/**
 * The semantic contrast pairs the gate evaluates — the render's classed elements bind to these roles
 * (body text, label text, primary action, error text, input border, focus ring).
 */
export const CONTRAST_PAIRS: ContrastPair[] = [
  { token: "text-body", fg: PRIMITIVES.ink, bg: PRIMITIVES.surface, kind: "text" },
  { token: "text-label", fg: PRIMITIVES.ink, bg: PRIMITIVES.surface, kind: "text" },
  { token: "text-error", fg: PRIMITIVES.danger, bg: PRIMITIVES.surface, kind: "text" },
  { token: "action-primary", fg: PRIMITIVES.onPrimary, bg: PRIMITIVES.primary, kind: "text" },
  { token: "ui-input-border", fg: PRIMITIVES.border, bg: PRIMITIVES.surface, kind: "ui" },
  { token: "ui-focus-ring", fg: PRIMITIVES.focus, bg: PRIMITIVES.surface, kind: "ui" },
];
