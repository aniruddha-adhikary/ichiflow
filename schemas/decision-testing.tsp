import "@typespec/json-schema";
import "./reference-data.tsp";
import "./decision-contracts.tsp";

using TypeSpec.JsonSchema;
using Ichiflow.ReferenceData;
using Ichiflow.Decision;

/**
 * Decision testing as a first-class governed artifact (build plan 2.4; doc 03 §6). A **`Harness`**
 * bundles a DecisionModel's business-readable **scenario specs** (given/expect) with the rule/row
 * **coverage threshold** a released model must meet (§6.2). Each `expect` asserts a full typed
 * `Outcome` (§6.1) — its `type`, its `reasons`, and, where relevant, its attached `conditions` with
 * expected `kind`/`state` — not merely a scalar outcome + reason codes. The `decision-layer`
 * harness runs the suite (`scenarios_pass / total`), gates coverage, and freezes this shape.
 */
@jsonSchema
namespace Ichiflow.DecisionTesting;

/** The asserted lifecycle state of one expected Condition (doc 03 §6.1). */
model ExpectedCondition {
  /** The governed condition code (into a `conditions`/`obligations` CodeSet). */
  code: CodeRef;

  kind: ConditionKind;

  state: ConditionState;
}

/**
 * The expected typed `Outcome` for a scenario case (doc 02 §9.3, doc 03 §6.1). `reasons`/`conditions`
 * are asserted when relevant; a plain approve/deny case asserts only `type` (+ reasons).
 */
model ExpectedOutcome {
  type: OutcomeType;

  /** Expected machine-readable reasons (governed CodeSet rows). */
  reasons?: CodeRef[];

  /** Expected attached conditions, each with its expected kind + state. */
  conditions?: ExpectedCondition[];
}

/** One business-readable given/expect case (doc 03 §6.1). */
model ScenarioCase {
  /** Human-readable case name; doubles as documentation of intent. */
  name: string;

  /** Named inputs the DecisionModel is evaluated against. */
  given: Record<unknown>;

  /** The full typed Outcome this case must produce. */
  expect: ExpectedOutcome;
}

/** A named scenario — a group of given/expect cases (doc 03 §6.1). */
model Scenario {
  name: string;
  cases: ScenarioCase[];
}

/**
 * A governed **`Harness`** — the DecisionModel's scenario suite + coverage gate, versioned with the
 * model and required for release (doc 03 §6). The decision-source model itself lives beside the
 * harness (`<id>.source.json`); the harness references it by `decisionModel` id@version.
 */
model Harness {
  kind: "Harness";

  /** The DecisionModel under test, as `id@version`. */
  decisionModel: string;

  /** Minimum rule/row coverage the scenario suite must achieve (0..1) for release (§6.2). */
  @minValue(0) @maxValue(1) coverageThreshold: float64;

  scenarios: Scenario[];
}

/**
 * A frozen **FEEL semantics vector** (build plan 2.4; doc 13 §2.b, doc 03 open-q4). The known
 * DMN/FEEL interchange-ambiguity cases — under-specified built-ins conformant engines resolve
 * differently (list `sort` ordering, string built-ins, date arithmetic; research 01 §7) — pinned to
 * the reference engine's *chosen, published* result. A KIE bump that silently shifts one fails loudly.
 */
model FeelVector {
  /** Stable vector id. */
  id: string;

  /** The FEEL expression evaluated on the reference engine. */
  expr: string;

  /** The pinned, published result as its FEEL string form. */
  expect: string;

  /** Why this case is interchange-ambiguous (documentation of the pinned resolution). */
  note?: string;
}
