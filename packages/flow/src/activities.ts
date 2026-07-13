import type { ComputeOp } from "./dsl.js";

/**
 * The single pure transform behind a `compute` step. Kept side-effect-free and total so it doubles as
 * the reference an independent host can fold to derive a flow's expected result (used by the spike to
 * assert the interpreter computed the right answer, not merely a stable one).
 */
export function applyCompute(op: ComputeOp, value: number): number {
  switch (op) {
    case "double":
      return value * 2;
    case "inc":
      return value + 1;
    case "identity":
      return value;
  }
}

export async function compute(input: {
  op: ComputeOp;
  value: number;
}): Promise<{ result: number }> {
  return { result: applyCompute(input.op, input.value) };
}

export const activities = { compute };
