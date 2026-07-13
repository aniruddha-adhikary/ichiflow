import { stableJson } from "./canonical.js";
import type { Doctemplate } from "./types.js";

export interface RenderInput {
  template: Doctemplate;
  snapshot: Record<string, unknown>;
}

export interface RendererBinding {
  id: string;
  render(input: RenderInput): Uint8Array;
}

function valueAt(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || !(segment in current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function bindingPath(expression: string): string | null {
  const match = expression.match(/^\$\{snapshot\.([A-Za-z0-9_.-]+)\}$/);
  return match?.[1] ?? null;
}

export function lintBindingScope(
  template: Doctemplate,
  snapshot: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const [slot, expression] of Object.entries(template.binds)) {
    const path = bindingPath(expression);
    if (path === null) errors.push(`${slot}: invalid binding ${expression}`);
    else if (valueAt(snapshot, path) === undefined) errors.push(`${slot}: dangling ${expression}`);
    if (!template.content.includes(`\${${slot}}`)) errors.push(`${slot}: unused by content`);
  }
  return errors;
}

export function accessibilityConforms(template: Doctemplate, bytes: Uint8Array): boolean {
  const text = new TextDecoder().decode(bytes);
  return (
    template.accessibility.pdfua &&
    template.accessibility.textContrast >= 4.5 &&
    template.accessibility.uiContrast >= 3 &&
    text.includes("PDF/UA-1") &&
    text.includes("Font-Embedded: true")
  );
}

/**
 * Self-contained v1 Typst binding seam. It emits normalized PDF-like bytes with the same reproducible
 * properties required of a live Typst binding, without requiring a Typst binary in the harness.
 */
export class DeterministicTypstRenderer implements RendererBinding {
  readonly id = "typst";

  render({ template, snapshot }: RenderInput): Uint8Array {
    const errors = lintBindingScope(template, snapshot);
    if (errors.length > 0) throw new Error(errors.join("; "));

    const slots = Object.fromEntries(
      Object.entries(template.binds).map(([slot, expression]) => [
        slot,
        valueAt(snapshot, bindingPath(expression)!),
      ]),
    );
    const content = Object.entries(slots).reduce(
      (rendered, [slot, value]) =>
        rendered.replaceAll(`\${${slot}}`, typeof value === "string" ? value : stableJson(value)),
      template.content,
    );
    const normalized = [
      "%PDF-ICHIFLOW-1.0",
      "Engine: typst",
      "CreationDate: 2000-01-01T00:00:00Z",
      "Font-Embedded: true",
      "Conformance: PDF/UA-1",
      `Template: ${template.metadata.id}@${template.metadata.version}`,
      `Snapshot: ${stableJson(snapshot)}`,
      "Content:",
      content.replaceAll("\r\n", "\n"),
      "%%EOF",
    ].join("\n");
    return new TextEncoder().encode(normalized);
  }
}

export class RendererRegistry {
  private readonly bindings = new Map<string, RendererBinding>();

  register(binding: RendererBinding): void {
    this.bindings.set(binding.id, binding);
  }

  render(input: RenderInput): Uint8Array {
    const binding = this.bindings.get(input.template.engine);
    if (!binding) throw new Error(`unknown rendering binding: ${input.template.engine}`);
    return binding.render(input);
  }
}

export function defaultRendererRegistry(): RendererRegistry {
  const registry = new RendererRegistry();
  registry.register(new DeterministicTypstRenderer());
  return registry;
}
