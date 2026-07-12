# 0029 — Document issuance as a first-class capability: `Document` + `doctemplate` + `issue-document`

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/02-workflow-orchestration.md](../research/02-workflow-orchestration.md) (human-in-the-loop / await-signal + SLA, reused for the offer-acceptance facet), [../research/03-schema-and-types.md](../research/03-schema-and-types.md) (governed artifact classes, versioning), [../research/05-audit-observability-deployment.md](../research/05-audit-observability-deployment.md) (DecisionRecord, retention/redaction, crypto-shredding)
- Basis: founder requirement 2026-07 — "approvals **issue** domain-named artifacts — a Customs Clearance Permit PDF, a grant Letter of Offer / certificate. Make document issuance a first-class, API-first, extensible capability." Reconciles the pre-normative `Document` / `doctemplate` / `issue-document` nouns already used by the delivered case studies (IPA letters, ballot notices, discharge vouchers).

## Context

An approval in casework rarely *ends* at "resolved" — it **produces the governed instrument the approval
entitles**: a permit, a licence, a certificate, a grant Letter of Offer, an adverse-action letter. ichiflow
already had the pieces around this hole — templated **notification delivery** over outbound Adapters
([05](../architecture/05-adapters.md) §4.2), a **versioned governed output artifact** a Case produces
([04](../architecture/04-flow-and-case-layer.md) §5.1), per-audience **CodeSet display** for coded content
([02](../architecture/02-schema-foundation.md) §9.2), and the **DecisionRecord** audit spine
([08](../architecture/08-audit-and-observability.md) §1) — but no first-class **issuance** capability that
ties them together: generate an immutable, versioned artifact from a data snapshot, allocate a governed
reference number, render it deterministically, give it a verifiable identity, drive its lifecycle, and
deliver it. Doc 05 §4.2 explicitly scoped "rich document generation (rendered PDF letters/permits,
object-store retention)" **out** of the adapter layer as "a proposed module."

Three delivered case studies (work-pass, public-housing-ballot, motor-insurance-claim) already **used** the
nouns `Document` / `doctemplate` / `issue-document` **pre-normatively** — the IPA letter and the Employment
Pass itself, the ballot-result notice, and four claim letters/vouchers — flagging in their gaps that the
nouns awaited a normative owner. This ADR is that owner.

## Decision

Make **Document issuance a first-class, API-first, extensible capability** across three artifacts:

1. **`Document`** — an **immutable, versioned, issued** artifact ([04](../architecture/04-flow-and-case-layer.md)
   §2.9): generated from a **data snapshot + the Case `Outcome`** (conditions rendered per-audience via
   CodeSet display), stamped with an allocated **reference number** (a governed **number-allocation contract**
   with **gap-free vs gapped** semantics), a **verification hash**, and an optional **public verification
   endpoint** (a presenter checks authenticity + current status **without seeing Case data**). Lifecycle:
   `issued → superseded` (reissue/variation) `→ revoked` (cancellation/clawback), each an audited
   DecisionRecord event ([08](../architecture/08-audit-and-observability.md) §1.6); an **acceptance facet**
   (`issued → accepted | declined`) is an optional offer-type lifecycle that **participates in the Flow** (the
   grants Letter-of-Offer needs this). The **binary is derived** — canonical truth is *data snapshot +
   template version → deterministic re-render* — stored via an **object-storage SPI**
   ([02](../architecture/02-schema-foundation.md) §11) as a cache, which is what lets **crypto-shredding**
   reconcile immutability with GDPR erasure ([08](../architecture/08-audit-and-observability.md) §1.6).
   The `Document` **is** the versioned governed output artifact of doc 04 §5.1.

2. **`doctemplate`** — a **new governed designer artifact class**, sibling of `uischema`/`pageschema`/`copyset`
   ([07](../architecture/07-ui-and-portals.md) §15): a versioned template binding schema'd fields → a print/PDF
   layout, **designer-ownable via the Design Kit** (AI-chat authoring + read-only preview, ADR-0019),
   registered/CI-gated like any contract, with i18n via `copyset`/CodeSet display and **PDF/UA** accessibility.
   Rendering is a **pluggable engine SPI**; the v1 **default is Typst** (Apache-2.0; deterministic
   fixed-timestamp output; native PDF/UA-1 + PDF/A; small self-contained binary), with **WeasyPrint**
   (BSD-3-Clause, HTML/CSS-native) the sanctioned alternative and **Playwright/Chromium** available but
   **non-default** (heavy, non-deterministic, weakest PDF/UA). The choice follows licensing hygiene (BRIEF
   §14/§15) and the determinism + accessibility bars.

3. **`issue-document`** — a **canonical Flow step** ([04](../architecture/04-flow-and-case-layer.md) §2.9),
   **not** a compute-variant extension type (§2.7). A step is canonical when the **interpreter must understand
   its control-flow semantics to replay them deterministically**; `issue-document` fails the compute reduction
   because **reference-number allocation is a side effect** (consumes a monotonic counter — not pure/re-runnable
   like `compute`, §2.6; the interpreter **memoizes** the allocation + lifecycle mutation keyed by `(case_id,
   step.id)`, exactly-once-ish under at-least-once execution) **and** the **offer-acceptance await** is durable
   interpreter control-flow (the `human-task` await shape, §5.2). What *is* pure — the render — is **dispatched
   through the rendering SPI beneath the one step**, exactly as transport is a pluggable Adapter binding beneath
   `external-task` (ADR-0028). Declaration shape: **`doctemplate` ref + field binding + number-allocation ref +
   delivery** (portal link and/or outbound notification adapter).

Cross-cutting:

- **API-first + PDP-scoped.** Documents list/fetch per Case through the generated API; an external org sees
  **only its own** Documents via the ReBAC row filter ([07](../architecture/07-ui-and-portals.md) §15.6);
  the **public verification endpoint** is the deliberate data-minimal exception.
  `ichiflow-mcp` exposes `get_case_documents` (Tier-0) and `reissue_document` / `revoke_document` (Tier-2,
  JIT + approval + audit) ([10](../architecture/10-ai-native-experience.md) §3.2).
- **Extensible with no framework change.** A new Document kind is **pure Workspace artifacts** — a
  `doctemplate` + an `issue-document` step declaration; the rendering SPI is swappable; delivery composes with
  notification adapters (doc 05 §4.2) rather than a parallel delivery stack.
- **Harness.** Render determinism (same snapshot + template version → normalized-identical output),
  verification-endpoint vectors (genuine/tampered/unknown, status, no-data-leak), and lifecycle conformance
  (reissue/revoke/accept + **replay idempotency**, gap-free contiguity) ship as harness §2.k
  ([13](../architecture/13-agent-harness-loops.md)); the `issue-document` step ships its flow vectors first
  (§2.c).

## Alternatives considered

- **Model issuance as `adapter-call` (render + send) — the doc 05 §4.2 notification path extended. Rejected.**
  Notification delivery is real and reused for *delivery*, but it carries **none** of the semantics that make
  an *issued instrument* correct: no allocated reference number with gap-free/gapped guarantees, no immutable
  versioned lifecycle (supersede/revoke/accept), no verification identity, no derived-binary/re-render truth,
  no per-Document audit chain. A permit is not a notification; it is a governed record with a life of its own.
- **A raw `compute` step (or `x-<org>` extension step type) that renders + returns the bytes. Rejected.** A
  `compute` activity is **pure and runs to completion** ([04](../architecture/04-flow-and-case-layer.md) §2.6);
  it cannot host a **non-pure monotonic allocation** that must be exactly-once-memoized on replay, nor a
  **durable acceptance await under a clock**. Burying allocation + lifecycle in an activity abandons replay
  idempotency and the audit spine — the same reasoning that makes `external-task` canonical (ADR-0028). The
  render, which *is* pure, is the part that runs as an activity — beneath the canonical step, not as it.
- **Bundle a document engine and make it non-swappable. Rejected.** Rendering is a **non-differentiating,
  well-served** concern (BRIEF §17); a fixed engine forfeits licensing hygiene and the determinism/a11y
  trade-offs that differ by engine. An SPI keeps Typst the default while WeasyPrint/others bind without a core
  change.
- **Default to Playwright/Chromium print-to-PDF. Rejected as default.** Chromium renders anything designers
  already know (HTML/CSS), but a bundled headless browser is **heavy** (footprint, air-gap cost), its output
  is **hard to make byte-deterministic** (defeating the render-determinism harness), and its **PDF/UA** story
  is weakest — three strikes against ichiflow's determinism + licensing + accessibility bars. It stays an
  available non-default binding.
- **Store the rendered binary as the source of truth. Rejected.** Treating the PDF as canonical makes GDPR
  erasure irreconcilable with immutability and makes "re-render as-of issuance" impossible. Making the binary
  **derived** (snapshot + template pin) is what buys crypto-shredding, deterministic reproduction, and a
  template change never mutating already-issued Documents.

## Consequences

Positive:
- One capability carries **allocation + versioned lifecycle + verification + audit + delivery** for **every**
  issued instrument, over **any** rendering engine, extensible as pure Workspace artifacts — a new permit or
  letter is a `doctemplate` + a step declaration, no framework change.
- Clean symmetry with the existing await steps: the **offer-acceptance** facet reuses the `human-task` await +
  pausable SLA (§5.7), and the **canonical-vs-compute** argument mirrors ADR-0028 exactly, so there is one
  mental model for "the interpreter owns the durable/side-effecting semantics; the pluggable part sits beneath
  the step."
- The **derived-binary** stance makes issuance *provable* (render determinism), *reproducible* (re-render
  as-of issuance), and *erasable* (crypto-shredding) at once — three requirements one design satisfies.
- Retro-fits the three delivered case studies' pre-normative nouns with a normative definition their usage
  already matches (see Reconciliation).

Negative / costs:
- The interpreter gains another **side-effecting, replay-sensitive** step: number allocation and lifecycle
  mutation must be exactly-once-memoized under replay/continue-as-new, and **gap-free** allocation adds
  serialized-allocation + void-ledger cost (mitigated: memoization reuses the durable-side-effect discipline;
  the residual reissue-numbering + gap-free-under-replay detail is a doc 04 open question, ships harness-first).
- **Rendering-engine sprawl** is real (Typst / WeasyPrint / Chromium under one SPI); v1 ships Typst as the
  default binding, WeasyPrint as an alternative, Chromium as non-default — each binding must pass the §2.k
  render-determinism + PDF/UA vectors before it is admitted.
- The **designer-facing template language** (Typst markup vs an HTML/CSS subset vs an engine-neutral DSL the
  SPI lowers) is **not yet fixed** ([07](../architecture/07-ui-and-portals.md) open-q9) — a `doctemplate`
  should not silently couple to one engine's syntax.
- As with all ichiflow-native step kinds, `issue-document` does not guarantee round-trip to other CNCF-SWF
  runtimes; its export-degradation contract is the same open question as the other native step types (doc 04
  open questions).

## Reconciliation with the delivered case studies

The case-study agents own `docs/examples/` and used these nouns ahead of this ADR; this design is written to
**accommodate** their usage. Where an assumption differs, it is noted here (the case studies are **not** edited
by this ADR):

- **work-pass-compass.md** — uses `issue-document` for the **IPA letter** then the **Employment Pass** as a
  **long-lived entitlement Document** with a validity window, and a `cancel` Case revoking the pass. Matches
  this design directly (issued → revoked; the pass is the versioned governed output artifact). **Reconciliation:**
  the pass's **validity window** (`validFrom`/`validTo`/`renewableFrom`) is a domain field carried in the
  `binding`, not a core lifecycle state — the normative lifecycle is `issued → superseded → revoked` (+ offer
  accept/decline); "valid/expired" is a derived view over the validity fields, and a renewal is a correlated
  child Case (as the case study already models it). No change needed to their usage.
- **public-housing-ballot.md** — issues the **ballot-result notice** as a Document inside a `loop` (one per
  Case), recorded in the DecisionRecord and reproducible as-of the issue instant. Matches directly (derived
  binary + audit event). **Reconciliation:** the notice is a plain issued Document (`acceptance: none`); no gap.
- **motor-insurance-claim.md** — issues **four** correspondence Documents (approval-of-repair, discharge
  voucher, settlement letter, decline letter), each snapshotted into the DecisionRecord; the discharge
  voucher's **signature releases the claim**. Matches directly. **Reconciliation:** the discharge voucher's
  countersignature is an **acceptance-facet** (`issued → accepted`) whose accepted-event gates the settlement
  step — the case study describes the behaviour narratively; expressing it as `lifecycle.acceptance: offer`
  would make the gate explicit, but is not required for the study to be correct. Its gap note already flags the
  nouns as pre-normative to reconcile against this ADR.

## References

- [04-flow-and-case-layer.md](../architecture/04-flow-and-case-layer.md) §2.3 (step-type table), §2.9 (the
  `issue-document` step, number allocation, lifecycle, derived-binary, verification), §5.1 (versioned governed
  output artifact), §5.6 (post-submission operations), §7 (DecisionRecord feed)
- [07-ui-and-portals.md](../architecture/07-ui-and-portals.md) §15 (`doctemplate`, rendering-engine SPI,
  PDF/UA, i18n, PDP-scoped fetch), §13 (designer artifact classes), §12 (safety contract)
- [02-schema-foundation.md](../architecture/02-schema-foundation.md) §10 (artifact-type catalog), §11 (entity
  store + object-storage SPI)
- [08-audit-and-observability.md](../architecture/08-audit-and-observability.md) §1.6 (Document lifecycle
  events, verification, crypto-shredding redaction), §7 / open-q4 (crypto-shredding)
- [05-adapters.md](../architecture/05-adapters.md) §4.2 (notification delivery this composes with)
- [10-ai-native-experience.md](../architecture/10-ai-native-experience.md) §3.2 (`get_case_documents` Tier-0;
  `reissue_document` / `revoke_document` Tier-2)
- [13-agent-harness-loops.md](../architecture/13-agent-harness-loops.md) §2.k (issuance harness), §2.c
  (issue-document flow vectors)
- Rendering-engine research (2026): Typst (Apache-2.0; PDF/UA-1 + PDF/A; reproducible fixed-timestamp output;
  Typst 0.14, 2025) · WeasyPrint (BSD-3-Clause; PDF/UA + PDF/A; v69.0, 2026) · Playwright/Chromium (non-default)
- Related: [0028](0028-delegation-step.md) (the canonical-vs-compute argument pattern + pluggable-seam-beneath-a-canonical-step shape this reuses), [0004](0004-declarative-flow-dsl-on-temporal.md) (closed canonical step set + `compute` hatch + extension step types), [0008](0008-jsonforms-model-ui-overrides.md) (the designer artifact-class DNA `doctemplate` extends), [0019](0019-ai-chat-first-authoring.md) (chat-to-author / preview-to-judge for `doctemplate`), [0011](0011-decisionrecord-and-selective-event-sourcing.md) (DecisionRecord + crypto-shredding)
