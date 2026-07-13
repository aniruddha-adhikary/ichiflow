import type { Pdp } from "./pdp/engine.js";
import type { FieldEntitlement } from "./types.js";

/**
 * Field-level entitlements for the Case action form, derived from the SAME PDP relations as row
 * filtering (doc 07 §6/§11). A field resolves to editable / read-only / hidden, each carrying the
 * PDP reason that powers the "why is this hidden?" affordance (doc 07 §6). The rule set is small and
 * relation-driven so it stays honest to the one-PDP invariant:
 *   - `decision` (the action outcome): editable if `can_modify`, else read-only if `can_view`;
 *   - `reviewerNote` (internal): visible only with `can_modify`, otherwise hidden;
 *   - `applicantName` (display): read-only for any viewer.
 */
export function fieldEntitlements(pdp: Pdp, principal: string, caseId: string): FieldEntitlement[] {
  const canModify = pdp.check(principal, "can_modify", caseId);
  const canView = canModify || pdp.check(principal, "can_view", caseId);

  return [
    {
      field: "applicantName",
      state: canView ? "read-only" : "hidden",
      reason: canView
        ? "display field: read-only for any viewer"
        : `hidden: ${principal} lacks can_view on ${caseId}`,
    },
    {
      field: "decision",
      state: canModify ? "editable" : canView ? "read-only" : "hidden",
      reason: canModify
        ? `editable: ${principal} holds can_modify on ${caseId}`
        : canView
          ? `read-only: ${principal} holds can_view but not can_modify on ${caseId}`
          : `hidden: ${principal} lacks can_view on ${caseId}`,
    },
    {
      field: "reviewerNote",
      state: canModify ? "editable" : "hidden",
      reason: canModify
        ? `editable: ${principal} holds can_modify on ${caseId}`
        : `hidden: internal note requires can_modify; ${principal} has none on ${caseId}`,
    },
  ];
}
