import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkContrast, contrastRatio } from "../src/contrast.js";
import { generateBaseline, humanize } from "../src/generator.js";
import { collectControls, lintScopes, resolveScope } from "../src/lint.js";
import { loadSchemaBundle, rendererFor, schemaVersion } from "../src/schema-io.js";
import { renderStoryFragment } from "../src/render.js";
import { reconcileSnapshots } from "../src/snapshots.js";
import { buildStories } from "../src/stories.js";
import type { JsonSchema, UiSchema } from "../src/types.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");
const generatedDir = join(repoRoot, "schemas", "generated", "json-schema");
const DATA_ID = "LoanApplication.json";

const bundle = loadSchemaBundle(generatedDir);
const version = schemaVersion(generatedDir, DATA_ID);
const dataSchema = bundle[DATA_ID] as JsonSchema;

describe("humanize", () => {
  it("title-cases camelCase and delimited names", () => {
    expect(humanize("applicant")).toBe("Applicant");
    expect(humanize("productCode")).toBe("Product Code");
    expect(humanize("data_schema-ref")).toBe("Data Schema Ref");
  });
});

describe("generateBaseline", () => {
  it("emits one Control per data-schema property in declared order", () => {
    const ui = generateBaseline(DATA_ID, bundle, version);
    expect(ui.layout.type).toBe("VerticalLayout");
    const controls = ui.layout.elements ?? [];
    expect(controls.map((c) => c.scope)).toEqual([
      "#/properties/applicant",
      "#/properties/amount",
      "#/properties/productCode",
      "#/properties/status",
    ]);
    expect(controls.map((c) => c.label)).toEqual(["Applicant", "Amount", "Product Code", "Status"]);
    expect(ui.dataSchema).toEqual({ id: DATA_ID, version });
  });

  it("is deterministic — identical output across runs (no wall-clock/RNG)", () => {
    const a = generateBaseline(DATA_ID, bundle, version);
    const b = generateBaseline(DATA_ID, bundle, version);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("scope lint", () => {
  const ui = generateBaseline(DATA_ID, bundle, version);

  it("passes when every Control scope resolves — including a $ref-typed field", () => {
    expect(lintScopes(ui, dataSchema, "baseline.json")).toEqual([]);
    // `status` is a $ref to LoanStatus.json; a placed $ref field must count as resolved.
    expect(resolveScope("#/properties/status", dataSchema)).toBeDefined();
  });

  it("catches a dangling scope with a fix-it hint naming the pointer and file (negative fixture)", () => {
    const drifted: UiSchema = {
      dataSchema: ui.dataSchema,
      layout: {
        type: "VerticalLayout",
        elements: [{ type: "Control", scope: "#/properties/renamedAway", label: "Gone" }],
      },
    };
    const dangling = lintScopes(drifted, dataSchema, "drifted.uischema.json");
    expect(dangling).toHaveLength(1);
    expect(dangling[0]!.pointer).toBe("#/properties/renamedAway");
    expect(dangling[0]!.file).toBe("drifted.uischema.json");
    expect(dangling[0]!.hint).toContain("#/properties/renamedAway");
  });
});

describe("renderer classification + stories", () => {
  it("classifies each LoanApplication field to a renderer kind", () => {
    const props = dataSchema.properties!;
    expect(rendererFor(props.applicant!, bundle)).toBe("text");
    expect(rendererFor(props.amount!, bundle)).toBe("number");
    expect(rendererFor(props.status!, bundle)).toBe("enum");
  });

  it("builds four PDP-state stories per placed control, in stable order", () => {
    const ui = generateBaseline(DATA_ID, bundle, version);
    const stories = buildStories(ui, DATA_ID, bundle);
    expect(stories).toHaveLength(collectControls(ui.layout).length * 4);
    expect(stories.slice(0, 4).map((s) => s.state)).toEqual([
      "hidden",
      "read-only",
      "error",
      "validation-failed",
    ]);
    const statusEnum = stories.find((s) => s.dataPath === "status")!;
    expect(statusEnum.renderer).toBe("enum");
    expect((statusEnum.enumOptions ?? []).length).toBeGreaterThan(0);
  });
});

describe("render (accessibility structure, deterministic markup)", () => {
  const ui = generateBaseline(DATA_ID, bundle, version);
  const stories = buildStories(ui, DATA_ID, bundle);

  it("renders identical markup across runs (no random ids/timestamps)", () => {
    const s = stories[0]!;
    expect(renderStoryFragment(s)).toBe(renderStoryFragment(s));
  });

  it("hidden state exposes a labelled 'why' affordance", () => {
    const hidden = stories.find((s) => s.state === "hidden")!;
    const html = renderStoryFragment(hidden);
    expect(html).toContain("Hidden by policy");
    expect(html).toContain(`aria-label="Why is ${hidden.label} hidden?"`);
  });

  it("error/validation states wire aria-invalid + a described-by alert", () => {
    const err = stories.find((s) => s.state === "validation-failed")!;
    const html = renderStoryFragment(err);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain(`id="ctrl-${err.dataPath}"`);
  });
});

describe("token-contract contrast", () => {
  it("meets WCAG 2.2 minimums for every semantic pair", () => {
    const results = checkContrast();
    expect(results.every((r) => r.pass)).toBe(true);
    expect(results.some((r) => r.kind === "text" && r.min === 4.5)).toBe(true);
    expect(results.some((r) => r.kind === "ui" && r.min === 3)).toBe(true);
  });

  it("computes a known contrast ratio (black on white = 21:1)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
  });
});

describe("snapshot reconciliation", () => {
  it("writes baselines in update mode, then matches them byte-for-byte", () => {
    const dir = mkdtempSync(join(tmpdir(), "ichiflow-snap-"));
    try {
      const fragments = [
        { id: "a--hidden", html: "<div>a</div>" },
        { id: "b--error", html: "<div>b</div>" },
      ];
      const written = reconcileSnapshots(dir, fragments, true);
      expect(written).toEqual({ produced: 2, matched: 2, drift: [] });
      expect(readFileSync(join(dir, "a--hidden.html"), "utf8")).toBe("<div>a</div>\n");

      const clean = reconcileSnapshots(dir, fragments, false);
      expect(clean.matched).toBe(2);
      expect(clean.drift).toEqual([]);

      const drifted = reconcileSnapshots(
        dir,
        [{ id: "a--hidden", html: "<div>changed</div>" }, fragments[1]!],
        false,
      );
      expect(drifted.matched).toBe(1);
      expect(drifted.drift[0]!.story).toBe("a--hidden");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
