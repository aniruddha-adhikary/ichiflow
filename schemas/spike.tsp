import "@typespec/json-schema";

using TypeSpec.JsonSchema;

/**
 * Cross-language fidelity spike (build plan chunk 1.0, ADR-0006; riskiest bet #5).
 *
 * A deliberately *hard* probe corpus: the constructs most likely to be interpreted differently by
 * two independent JSON Schema validators in two languages. If a TS validator (Ajv) and a JVM
 * validator (networknt) disagree on any accept/reject here, the whole "one schema, many languages"
 * premise needs adjustment *before* the pipeline is built on it. These types exist only to be
 * emitted to JSON Schema and hammered by `ichiflow verify --scope schema-fidelity-spike`.
 */
@jsonSchema
namespace Ichiflow.SpikeProbe;

@format("email")
scalar Email extends string;

/** Nullability: required-present, absent-allowed (optional), and explicit-null-allowed (nullable). */
model NullabilityProbe {
  /** Must be present and a string. */
  required: string;

  /** May be absent entirely, but if present must be a string (not null). */
  optional?: string;

  /** Must be present, but may be an explicit JSON null. */
  nullable: string | null;
}

/** `format` + numeric bounds: the classic sites of validator disagreement. */
model ScalarProbe {
  email: Email;
  when: utcDateTime;

  @minValue(1)
  @maxValue(5)
  rating: int32;

  @minValueExclusive(0)
  ratio: float64;
}

/** Discriminated union — a tagged `oneOf` keyed on `kind`. */
@discriminator("kind")
model Shape {
  kind: string;
}

model Circle extends Shape {
  kind: "circle";

  @minValue(0)
  radius: float64;
}

model Square extends Shape {
  kind: "square";

  @minValue(0)
  side: float64;
}

/** Untagged `oneOf` — a scalar union where the two branches are distinguishable by type. */
model UnionProbe {
  id: int32 | string;
}
