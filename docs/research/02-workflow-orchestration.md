# 02 — Workflow / Process Orchestration for ichiflow

> Research date: 2026-07-12. Versions, licensing, and project health verified against sources current as of mid-2026 (see Sources). Where a claim depends on a fast-moving fact (licensing, EOL, SDK status), the source URL is inline.

---

## 1. Executive Summary & Recommendation

ichiflow needs an orchestration layer for enterprise back-office and customer-facing flows that (a) run for days–months, (b) route to **manual review / human task queues** with assignment and escalation, (c) call a **Drools/Kogito-family rules layer**, (d) are **deeply auditable** ("why did this case take this path"), and (e) are **AI-agent-friendly to author**. Stack preference is **TypeScript + Kotlin**.

The market splits into two philosophies:

- **Code-first durable execution** (Temporal, Restate, DBOS, Inngest, Hatchet, Dapr Workflows, AWS Step Functions, Conductor). You write workflows as code (or JSON); the engine guarantees execution by persisting every step and replaying on failure. Strongest on guaranteed execution, testability, replay-as-audit, and independent scalability. Weakest on out-of-the-box **human task/case management** and business-user comprehension — you build those yourself.
- **Model-first BPMN/CMMN engines** (Camunda, Flowable, Kogito/jBPM). You draw the process as a diagram (BPMN) or case model (CMMN); the engine ships human task lists, forms, assignment, and audit UIs. Strongest on human-in-the-loop, business comprehension, and standards-based interchange. Weakest on the "just write code" ergonomics that LLMs and engineers both like, and (for Camunda 8) on licensing openness.

**Recommendation: adopt Temporal as ichiflow's durable execution core, and build a thin declarative flow layer (CNCF Serverless Workflow-aligned JSON/YAML DSL) on top of it, plus a first-party human-task/case-management module.** This gives ichiflow both worlds: durable, replayable, independently-scalable execution underneath (the hard part to build), and a business-comprehensible, AI-authorable declarative surface on top (the differentiating product surface). Rules evaluation and integration run as **separate multi-language activity workers** (Kotlin for Drools/Kogito rule eval, TypeScript for integration/API activities), which Temporal supports natively via task-queue routing.

Key reasons Temporal wins as the *substrate*:
- MIT-licensed server + SDKs; self-host with zero license fees, or Temporal Cloud when ready — no rug-pull risk of the kind Camunda 8 just executed. ([temporal.io](https://temporal.io/), [Temporal pricing 2026](https://automationatlas.io/answers/temporal-pricing-explained-2026/))
- **Replay + full event history is the audit/explainability mechanism** we want — every decision, timer, signal, and activity result is recorded and re-derivable. ([Event history](https://docs.temporal.io/encyclopedia/event-history/event-history-go), [Workflow definition](https://docs.temporal.io/workflow-definition))
- Mature **TypeScript SDK**; Kotlin is served via the JVM/Java SDK's `temporal-kotlin` extension (idiomatic-but-not-first-class). ([Temporal SDKs](https://docs.temporal.io/encyclopedia/temporal-sdks), [temporal-kotlin](https://mvnrepository.com/artifact/io.temporal/temporal-kotlin))
- Proven prior art for **declarative DSL interpreters on Temporal** (Zigflow, the official Temporal Serverless-Workflow DSL sample) means the "both worlds" strategy is de-risked, not speculative. ([Zigflow](https://zigflow.dev/articles/why-i-built-a-yaml-dsl-for-temporal-workflows/), [Temporal DSL code exchange](https://temporal.io/code-exchange/temporal-dsl))

**Primary risks to accept:** (1) Human task queues, escalation, and case management are **not built in** — ichiflow builds them (the signals/timers primitives are there; the UI, assignment engine, and task store are ours). This is *deliberate*: it becomes ichiflow's product moat, and it's the same code you'd write on any code-first engine. (2) Kotlin is not a first-class Temporal SDK; mitigate by keeping Kotlin confined to **activity workers** (which have no determinism constraints) and orchestrating from TypeScript.

**Secondary / hedge options:** If ichiflow's buyers demand *standards-based BPMN interchange and a turnkey human-task UI on day one* more than they demand code-first ergonomics, **Flowable** (Apache-2.0, real BPMN + CMMN + DMN, strong case management) is the better single-vendor answer and the cleanest "own it forever" open-source BPMN engine. **Camunda 8 is not recommended** as ichiflow's embedded engine because of its 2024 licensing change (production now requires a paid Camunda Enterprise license — see §6).

---

## 2. Analysis of the Two Paradigms (the core decision)

| Dimension | Code-first durable execution (Temporal et al.) | Model-first BPMN/CMMN (Camunda/Flowable/Kogito) |
|---|---|---|
| **AI authoring (LLM writes the flow)** | Strong — LLMs write TS/Kotlin/JSON well; workflows are ordinary code with tests. Best when paired with a constrained DSL. | Mixed — LLMs can emit BPMN XML but it's verbose, positional (diagram coordinates), and error-prone; harder to validate than typed code. |
| **Business-user comprehension / audit** | Weaker out of the box — code is opaque to analysts; needs a rendered view. A declarative DSL layer closes most of this gap. | Strong — the BPMN diagram *is* the shared artifact between analysts and engineers; token-flow is visually auditable. |
| **Human tasks / manual review** | Build-your-own (primitives: signals, timers, queries). | Built in — task lists, forms, assignment, escalation, admin UIs. |
| **Migration in/out** | Proprietary code (mitigated if you author in CNCF Serverless Workflow, a portable spec). | BPMN 2.0 XML is a genuine cross-vendor interchange standard (Camunda↔Flowable↔Kogito). |
| **Determinism + replay as audit** | First-class — replay reconstructs exactly why each path was taken. | Engine persists a variable/token history; less "re-derive from code," more "read the audit log." |
| **Guaranteed execution** | Core promise; the whole point of the category. | Yes, via persistent process state in the DB. |
| **Independent scalability** | Excellent — stateless workers scale per task queue; engine scales separately. | Good (Zeebe is horizontally scalable; classic jBPM/Flowable is DB-bound). |

**Synthesis for ichiflow:** The two hardest things to build are *durable execution* and *human-task/case-management*. Temporal gives us the first for free and lets us build the second as product. BPMN engines give us the second for free but hand us licensing/opacity problems and a weaker code/AI story. Because ichiflow is *AI-native* and wants a *declarative flow DSL* as its authoring surface anyway, layering that DSL on Temporal captures BPMN's comprehension/interchange benefits without adopting a BPMN engine. See §5 for prior art proving this is practical.

---

## 3. Per-Option Profiles

### Temporal — RECOMMENDED SUBSTRATE
Durable execution engine; workflows-as-code with automatic persistence + replay.
- **Licensing:** Server and SDKs are **MIT**. Self-host free; Temporal Cloud from **$100/mo (Essentials, 1M actions)**, ~$50/M actions beyond, Business $500/mo (adds SAML SSO), Enterprise from 10M actions. Self-host infra realistically ~$2.5–4.5k/mo plus ops labor for a production cluster (Cassandra/PostgreSQL/MySQL backing store). ([pricing](https://automationatlas.io/answers/temporal-pricing-explained-2026/), [self-host guide](https://docs.temporal.io/self-hosted-guide), [cloud vs self-host](https://automationatlas.io/guides/temporal-cloud-vs-self-hosted-2026/))
- **SDKs:** Go, Java, Python, TypeScript, .NET, PHP, Ruby official; Rust in preview. **TypeScript is mature/GA.** **Kotlin is via the Java SDK's `temporal-kotlin` module** (extension functions/DSL sugar over the Java SDK), *not* a standalone first-class SDK; a community `temporal-kt` exists but is early/unstable. ([SDKs](https://docs.temporal.io/encyclopedia/temporal-sdks), [temporal-kotlin](https://mvnrepository.com/artifact/io.temporal/temporal-kotlin), [temporal-kt](https://github.com/Snipesy/temporal-kt))
- **Determinism constraints:** Workflow code must be deterministic (no wall-clock, RNG, or uncontrolled I/O in workflow code — all such work goes in *activities*). This is the price of replay-based durability. ([workflow definition](https://docs.temporal.io/workflow-definition))
- **Testing:** First-class test framework with a time-skipping test server (fast-forward through day/month timers in tests) and a **replay/determinism test** that runs old histories against new code to catch non-deterministic changes before deploy.
- **Versioning/patching:** `patched()`/`GetVersion` insert markers into event history to branch new-vs-in-flight executions safely; "deprecated patch" retires a marker without breaking replay; Worker Versioning pins task queues to code builds. This is exactly the machinery a long-running (months) enterprise flow needs to evolve safely. ([patching](https://docs.temporal.io/patching), [TS versioning](https://docs.temporal.io/develop/typescript/workflows/versioning))
- **Visibility/audit:** Complete, queryable **Event History** per execution (every command, timer, signal, activity in/out); advanced Visibility (SQL-like search on custom search attributes). Replay re-derives the full decision path — strongest explainability story in the set. ([event history](https://docs.temporal.io/encyclopedia/event-history/event-history-go))
- **Human-in-the-loop:** Documented, mature *pattern* (not a product feature): workflow blocks on a **Signal** (approve/reject) with a **Timer** for SLA → escalate/auto-decide; idempotent signal handlers for double-clicks; state survives crashes/days of waiting. ([HITL approvals](https://temporal.io/blog/human-in-the-loop-approvals), [HITL cookbook](https://docs.temporal.io/ai-cookbook/human-in-the-loop-python))
- **Topology/multi-language:** Workers poll task queues; route Kotlin rule-eval activities to one queue, TS integration activities to another; workflow orchestrates both. **Nexus** (GA 2026) connects workflows across isolated namespaces/teams with retries, rate-limiting, load-balancing — good for ichiflow's future multi-team deployments. ([Nexus](https://docs.temporal.io/nexus))

### Camunda 8 / Zeebe — NOT RECOMMENDED as embedded engine (licensing)
Cloud-native BPMN engine (Zeebe) + Operate/Tasklist/Optimize.
- **Licensing (verified, the decisive issue):** Since **v8.6 (Oct 8, 2024)** a unified license requires a **paid Camunda Self-Managed Enterprise Edition for production**. Zeebe, Operate, Tasklist, Identity, Optimize source is under **Camunda License v1** (source-available, *non-production free only*); compiled production use needs the Enterprise license. Only the **Desktop Modeler (MIT)** and Connector SDK/REST connector (Apache-2.0) are freely production-usable. The previously-free self-managed production path is **gone**. ([licenses doc](https://docs.camunda.io/docs/reference/licenses/), [licensing update blog](https://camunda.com/blog/2024/04/licensing-update-camunda-8-self-managed/), [forum announcement](https://forum.camunda.io/t/important-licensing-changes-to-camunda-8-self-managed/51669))
- **Health:** Very active. Latest **8.9.x (8.9.11, Jun 26 2026)**. 8.9 adds global user-task listeners (self-managed), ad-hoc sub-process migration, RDBMS secondary storage (MySQL/SQL Server/Aurora), agentic orchestration features. Tasklist V1 removed in 8.10 → migrate to Tasklist V2. ([8.9 release notes](https://docs.camunda.io/docs/reference/announcements-release-notes/890/890-release-notes/))
- **Human tasks:** Built-in **Tasklist** (V2) with user task listeners, assignment, forms. Good.
- **Case management:** **No CMMN** — Camunda 8 dropped it entirely; case scenarios must be remodeled in BPMN (ad-hoc sub-processes). A real gap vs Flowable for unstructured case work. ([CMMN gone](https://camunda.com/blog/2020/08/how-cmmn-never-lived-up-to-its-potential/))
- **Verdict:** Technically strong and scalable, but embedding it makes ichiflow's customers liable for Camunda's production license — unacceptable coupling for a framework meant to be self-hostable.

### Camunda 7 — EOL managed; not a green-field choice
- Classic embeddable Java BPMN engine (Apache-2.0 community). **Community Edition EOL Oct 14, 2025** (final release 7.24; no further releases/security patches). **Enterprise Edition support extended to Apr 9, 2030** (+optional extended support to 2032). ([CE/EE EOL blog](https://camunda.com/blog/2025/02/camunda-7-enterprise-end-of-life-extension/), [announcements](https://docs.camunda.org/enterprise/announcement/))
- Great embeddable model, strong human-task API, but building a 2026 green-field product on a community-EOL'd engine is a dead end. Only relevant if migrating an existing C7 estate.

### Kogito / jBPM / Apache KIE — same family as the rules layer, but in flux
- **What it is:** jBPM (BPMN2 workflow engine, pure Java) + Kogito (cloud-native, Quarkus/Knative/Kafka) + Drools + OptaPlanner, now all under **Apache KIE (incubating)**. Since ichiflow's **rules layer is Drools/Kogito-family**, this is the most *cohesive* single-stack option (rules + process from one lineage). ([Apache KIE jBPM](https://kie.apache.org/components/jbpm/), [Kogito](https://kie.apache.org/components/kogito/))
- **Health:** Actively released (KIE artifacts Mar 2026), but the project is mid-donation to the Apache Incubator (namespace churn `org.kie.*`, "interfaces constantly changing"). Incubating status = governance/stability risk for a foundational dependency. ([kie.apache.org](https://kie.apache.org/docs/10.0.x/kogito/))
- **Human tasks:** Supported (User Task API in BPMN2), but Kogito's human-task story is lighter than classic jBPM's and typically needs companion services (Data Index, task console, Keycloak) — more assembly than Flowable/Camunda.
- **Verdict:** Keep as the **rules engine** (Drools/Kogito). As the *orchestrator*, its incubating flux and heavier human-task assembly make it a weaker choice than Temporal-as-substrate. Worth a shortlist slot only if ichiflow wants a single JVM-native rules+process runtime and can tolerate incubation risk.

### Flowable — best turnkey open-source BPMN/CMMN (the hedge)
- **What it is:** Apache-2.0 Java engine with **BPMN 2.0 + CMMN (real case management) + DMN**, REST APIs, task/forms UIs. Swiss-maintained, mature. 2025.x added agent/multi-agent engine + AI Studio. ([open source](https://www.flowable.com/open-source), [CMMN](https://www.flowable.com/solutions/cmmn), [GitHub](https://github.com/flowable/flowable-engine))
- **Case management:** **Strongest in the set** — genuine CMMN engine for unstructured/adaptive "case" work where task order isn't fixed (exactly ichiflow's manual-review scenarios). This is where Flowable beats Camunda 8 and the code-first engines out of the box.
- **Licensing:** Core engines **Apache-2.0** — freely embeddable in production, no rug-pull. This is the key advantage over Camunda 8.
- **Human tasks:** Built-in task service, assignment, escalation, forms.
- **Weaknesses:** JVM-centric (no first-class TS authoring; ichiflow's TS front would call it via REST); code/AI-authoring story is BPMN-XML, not code; horizontal scale is DB-bound (single relational store) vs Zeebe/Temporal's partitioned model.
- **Verdict:** **The recommended fallback** if ichiflow decides turnkey human-task + CMMN case management + BPMN interchange outweighs code-first/AI ergonomics. Cleanest "own it forever" open-source BPM.

### Restate — code-first, source-available
- Durable execution *as a service*: split durable code into a worker, Restate server dispatches. Rust core, strong on durable RPC/state; TS + JVM SDKs. **License: BUSL-1.1 (source-available, not OSI-open)** — same category of commercial-restriction risk that makes us wary of Camunda 8, though far more permissive in practice. Fast-growing 2025–2026. ([comparison](https://www.pkgpulse.com/guides/inngest-vs-trigger-dev-v3-vs-restate-2026), [BUSL note](https://news.ycombinator.com/item?id=42821705))
- **Verdict:** Technically attractive, lighter-weight than Temporal, but BUSL + younger ecosystem + no built-in human tasks. Watch, don't bet.

### DBOS — durable execution as a *library* on Postgres
- Import a library, point it at Postgres, decorate functions as workflows/steps. Lowest-ops of the set (no separate cluster; your Postgres is the store). Python + TypeScript first. Great for "durable execution without running Temporal." Weaker for very-long-running human-task-heavy flows and cross-language workers. ([DBOS vs Temporal](https://www.tiarebalbi.com/en/blog/dbos-vs-temporal-postgres-durable-execution))
- **Verdict:** Excellent *simplicity* hedge if ichiflow wants to avoid operating a Temporal cluster early; revisit if Temporal ops cost proves too high. Not as strong on Kotlin or human-task orchestration.

### Inngest — serverless-first durable steps
- Event-driven durable functions optimized for "I have a web app → durable steps fast." TypeScript-centric, great DX, minimal migration. Managed-first (self-host exists but SaaS is the happy path). No native Kotlin; human-in-the-loop via `waitForEvent`. ([Inngest vs Temporal](https://www.inngest.com/compare-to-temporal))
- **Verdict:** Best time-to-value for a TS team, but SaaS-centric and JVM-second-class — misfit for a Kotlin-rules, self-hostable enterprise framework.

### Hatchet — Postgres-backed task orchestration, concurrency-focused
- Fine-grained concurrency/priority control, AI-task orchestration focus, Postgres-backed, self-hostable. Younger; smaller ecosystem; no built-in human-task/case UI. ([Hatchet vs Inngest](https://www.pkgpulse.com/guides/hatchet-vs-trigger-dev-v3-vs-inngest-durable-workflows-2026))
- **Verdict:** Niche fit (high-fan-out AI concurrency). Not a general enterprise-process orchestrator for ichiflow.

### AWS Step Functions — managed, cloud-locked
- JSON/ASL state machines, deep AWS integration, low ops. **Proprietary and AWS-locked**; standard workflows support long-running + human callbacks (task tokens). Wrong fit for a self-hostable, cloud-neutral framework, though fine as an optional deployment target. ([Conductor vs Step Functions](https://orkes.io/compare/orkes-conductor-vs-temporal))

### Netflix Conductor / Orkes — JSON-native, Apache-2.0 OSS
- **Conductor OSS (Apache-2.0, no proprietary server)** maintained by Orkes; JSON workflow definitions separate orchestration from workers → "deterministic by construction" (no determinism-in-code footguns). Native LLM/MCP orchestration built in. Orkes sells managed. Human tasks supported via wait/human tasks. ([Conductor FAQ](https://conductor-oss.github.io/conductor/devguide/faq.html), [Orkes vs Temporal](https://orkes.io/compare/orkes-conductor-vs-temporal))
- **Verdict:** The strongest *pure-OSS, JSON-declarative* alternative to "Temporal + our own DSL" — you get a declarative surface for free. Trade-off: less code-flexibility, human-task/case UI still build-your-own, and momentum/mindshare trails Temporal. **Credible #2 substrate** if ichiflow prefers a ready-made JSON model over building a DSL on Temporal.

### Dapr Workflows — CNCF, code-first, sidecar model
- CNCF Dapr's durable workflow engine (log-based checkpointing) + **Dapr Agents v1.0 GA (Mar 2026)** for AI agents. Runs as a sidecar; pluggable state stores; strong cloud-native/K8s story. Python-first for Agents; workflow SDKs across languages but less mature than Temporal's for complex long-running enterprise flows. Apache-2.0, CNCF governance = low rug-pull risk. ([Dapr Agents GA](https://www.cncf.io/announcements/2026/03/23/general-availability-of-dapr-agents-delivers-production-reliability-for-enterprise-ai/), [workflow overview](https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-overview/))
- **Verdict:** Interesting if ichiflow is deeply K8s/sidecar-native and Dapr is already in the stack. As a standalone orchestration bet it's less proven than Temporal for months-long human-task flows.

---

## 4. Comparison Matrix

| Option | Paradigm | License / commercial risk | Long-running (days/months) | Human tasks OOTB | Case mgmt (unstructured) | Replay/audit depth | TS SDK | Kotlin SDK | Indep. scalability | AI-author fit | Interchange/portability |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Temporal** | Code-first durable | **MIT**, low risk | Excellent | No (build) | No (build) | **Excellent** (event history + replay) | **Mature** | Via Java SDK ext | Excellent | High (code + DSL) | Low (proprietary; DSL mitigates) |
| **Camunda 8/Zeebe** | Model-first BPMN | **Prod = paid Camunda License v1**, HIGH | Good | **Yes** (Tasklist V2) | No CMMN | Good (audit log) | via REST | via REST/Java | Excellent | Medium (BPMN XML) | **BPMN 2.0** |
| **Camunda 7** | Model-first BPMN | CE **EOL Oct 2025**; EE to 2030 | Good | Yes | No CMMN | Good | via REST | Java-native | Medium (DB-bound) | Medium | BPMN 2.0 |
| **Kogito/jBPM (Apache KIE)** | Model-first BPMN2 | Apache-2.0 but **incubating flux** | Good | Yes (lighter) | Partial | Good | via REST | Java/Quarkus | Good (Kogito) | Medium | BPMN 2.0 |
| **Flowable** | Model-first BPMN/CMMN | **Apache-2.0**, low risk | Good | **Yes** | **Yes (CMMN)** | Good | via REST | Java-native | Medium (DB-bound) | Medium (BPMN XML) | **BPMN/CMMN/DMN** |
| **Restate** | Code-first durable | **BUSL-1.1**, med | Good | No (build) | No | Good | Yes | JVM SDK | Good | High | Low |
| **DBOS** | Library on Postgres | OSS/Apache-ish, low | Good | No (build) | No | Good (Postgres log) | Yes | No | Good | High | Low |
| **Inngest** | Serverless durable | OSS core + SaaS, med | Good | No (waitForEvent) | No | Good | **Excellent** | No | Good (SaaS) | High (TS) | Low |
| **Hatchet** | Postgres task orch | OSS, low-med | Good | No | No | Good | Yes | No | Good | Medium | Low |
| **AWS Step Functions** | Managed JSON/ASL | **Proprietary, AWS-lock** | Good (Standard) | Callback tokens | No | Good (exec history) | via SDK | via SDK | Managed | Medium (ASL) | Low |
| **Conductor/Orkes** | JSON-declarative | **Apache-2.0** OSS | Good | Human tasks | Partial | Good | Yes | via API | Excellent | High (JSON) | Medium (JSON spec) |
| **Dapr Workflows** | Code-first sidecar | **Apache-2.0/CNCF**, low | Good | No (build) | No | Good (checkpoints) | Yes | via SDK | Excellent (K8s) | Medium-High | Low |

---

## 5. "Declarative DSL over a Durable Engine" — Prior Art

The strategic question: **can ichiflow cleanly layer a declarative flow DSL (JSON/YAML/DMN-like) on Temporal to get both the code-first substrate and the business-comprehensible/portable surface?** Answer: **yes — this is an established pattern with multiple working implementations.**

- **CNCF Serverless Workflow specification** — a vendor-neutral, declarative DSL (YAML/JSON) for workflows; v1.0 defines a fixed set of task types every compliant runtime must support. Authoring ichiflow flows in this spec buys **portability** (the migration-out hedge against "proprietary Temporal code") while still executing on Temporal. ([serverlessworkflow.io](https://serverlessworkflow.io/), [SWF 1.0 DSL](https://gillesbarbier.medium.com/understanding-the-serverless-workflow-1-0-dsl-6e874a1fd511))
- **Temporal's own DSL sample** — the official "Temporal DSL" implements the Serverless Workflow DSL so you define Temporal workflows in YAML; a generic interpreter workflow reads the DSL and drives activities. Confirms Temporal endorses/anticipates the interpreter pattern. ([Temporal DSL code exchange](https://temporal.io/code-exchange/temporal-dsl))
- **Zigflow (2026)** — a production YAML DSL that *compiles CNCF-Serverless-Workflow-style definitions into Temporal workflow implementations*. Direct, recent proof that ichiflow's exact plan works. ([why a YAML DSL for Temporal](https://zigflow.dev/articles/why-i-built-a-yaml-dsl-for-temporal-workflows/), [Zigflow: the missing Temporal DSL](https://simonemms.com/blog/2026/02/02/zigflow-the-missing-temporal-dsl))
- **DSL-based Temporal orchestration write-ups** — the canonical layered architecture is: **DSL definitions (YAML/JSON) → parser/interpreter → Temporal SDK → Temporal Service.** The interpreter is itself a deterministic Temporal workflow; DSL steps map to activities. ([Part 1 arch](https://medium.com/@nareshvenkat14/dsl-based-workflow-orchestration-part-1-introduction-architecture-9d0112f77e00), [Part 2 syntax](https://medium.com/@nareshvenkat14/dsl-based-temporal-workflow-orchestration-part-2-dsl-concepts-syntax-2100cd8e1d50))
- **Conductor/Orkes** is effectively the "JSON DSL over durable engine" idea shipped as a product (JSON workflow defs, generic orchestrator) — a proof of the model, and ichiflow's ready-made alternative to building its own DSL (see §3).

**Design implication for ichiflow.** Build a single deterministic **interpreter workflow** in TypeScript that (1) loads a versioned ichiflow flow document (JSON/YAML, CNCF-SWF-aligned + DMN-like decision nodes that call the Drools/Kogito rules activities), (2) walks the graph, invoking activities on the right task queue (Kotlin rule-eval vs TS integration), and (3) treats **manual-review nodes** as "await signal with SLA timer → escalate." Benefits: business users read/diff the flow doc (comprehension + audit), the doc is portable (migration hedge), the interpreter is a normal Temporal workflow (durability, replay, versioning via `patched()`), and an LLM authors *flow documents* — a constrained, schema-validated JSON surface — instead of free-form workflow code (safer AI authoring). Pin the interpreter's DSL-schema version with Temporal's patching so long-running instances keep replaying against the schema they started on.

---

## 6. Human-Task / Case-Management Gap Analysis

ichiflow's manual-review requirement (task queues, assignment, escalation, case management) is the sharpest differentiator between options.

- **Built-in, structured human tasks:** **Camunda 8 (Tasklist V2)**, **Flowable**, **Kogito/jBPM**, **Camunda 7** ship task lists, assignment, forms, and escalation. If ichiflow wanted this *turnkey today*, a BPMN engine wins — and **Flowable additionally ships CMMN** for genuine *unstructured case management* (adaptive task order), which **Camunda 8 lacks** (CMMN dropped; must be faked in BPMN ad-hoc sub-processes). ([Flowable CMMN](https://www.flowable.com/solutions/cmmn), [Camunda CMMN gone](https://camunda.com/blog/2020/08/how-cmmn-never-lived-up-to-its-potential/))
- **Build-your-own on durable primitives:** **Temporal, Restate, DBOS, Inngest, Hatchet, Dapr, Conductor** provide the *mechanics* — durable wait (signal/event), SLA timers, escalation branches, idempotent handlers — but **no task store, assignment engine, or reviewer UI**. Temporal's HITL pattern is well-documented and battle-tested, but it is a *pattern*, not a feature. ([Temporal HITL](https://temporal.io/blog/human-in-the-loop-approvals))

**Gap for the recommended path (Temporal):** ichiflow must build a **Manual-Review/Case module**: (a) a **task store** (task = {workflowId, type, payload, assignee, queue, SLA, state}) fed by workflows that emit "task created" and block on a signal; (b) an **assignment/routing engine** (round-robin, skill/role-based, load-based) — a natural home for the **Drools/Kogito rules layer** (assignment *is* a rule flow); (c) **escalation** via Temporal SLA timers (reassign/notify/auto-decide on expiry); (d) a **reviewer UI + API** that resolves a task by sending the signal back; (e) a **case aggregate** grouping related tasks/workflows with its own audit trail. This is real work, but it is (1) the same work required on *any* code-first engine, (2) ichiflow's product surface and moat, and (3) far more flexible than bending a BPMN task list to enterprise-specific routing. **Net:** accept the build; treat "case management" as a first-class ichiflow module layered on Temporal, with assignment logic expressed in the Drools/Kogito rules the platform already runs.

---

## 7. Licensing & Commercial Risk Summary

| Option | License | Production self-host free? | Rug-pull / lock-in risk |
|---|---|---|---|
| **Temporal** | MIT (server + SDKs) | **Yes** | Low — permissive, self-hostable; Cloud optional |
| **Flowable** | Apache-2.0 (core engines) | **Yes** | Low |
| **Kogito/jBPM (Apache KIE)** | Apache-2.0 | Yes | Low license risk, but **incubation/governance flux** |
| **Conductor OSS** | Apache-2.0 | Yes | Low |
| **Dapr** | Apache-2.0 (CNCF) | Yes | Low |
| **DBOS / Hatchet** | OSS (Apache-family) | Yes | Low-medium (young) |
| **Inngest** | OSS core + SaaS | Partial | Medium (SaaS-centric) |
| **Restate** | **BUSL-1.1** | Source-available | Medium (non-OSI restrictions) |
| **Camunda 8** | **Camunda License v1** (source-available) | **No — production needs paid Enterprise** | **High for an embedded framework** |
| **Camunda 7** | Apache-2.0 (CE) | Yes, but **CE EOL Oct 2025** | High (EOL) |
| **AWS Step Functions** | Proprietary | No (managed only) | High (AWS lock-in) |

**Bottom line on risk:** For a framework meant to be **self-hostable by ichiflow's customers**, the license must not impose downstream fees or EOL cliffs. That eliminates **Camunda 8** (production fee), **Camunda 7 CE** (EOL), and **Step Functions** (lock-in) as *embedded* choices, and puts a caution flag on **Restate** (BUSL). **Temporal (MIT)** and **Flowable (Apache-2.0)** are the two cleanest, which is why they are the recommendation and the hedge.

---

## 8. Sources

Temporal:
- https://temporal.io/ — product/overview
- https://automationatlas.io/answers/temporal-pricing-explained-2026/ — 2026 pricing & MIT self-host
- https://automationatlas.io/guides/temporal-cloud-vs-self-hosted-2026/ — self-host cost/topology
- https://docs.temporal.io/encyclopedia/temporal-sdks — official SDK list (Kotlin not first-class)
- https://mvnrepository.com/artifact/io.temporal/temporal-kotlin — Kotlin extension over Java SDK
- https://github.com/Snipesy/temporal-kt — community Kotlin-first wrapper (early)
- https://docs.temporal.io/workflow-definition — determinism constraints
- https://docs.temporal.io/patching and https://docs.temporal.io/develop/typescript/workflows/versioning — versioning/patching
- https://docs.temporal.io/encyclopedia/event-history/event-history-go — event history/audit
- https://temporal.io/blog/human-in-the-loop-approvals and https://docs.temporal.io/ai-cookbook/human-in-the-loop-python — HITL pattern
- https://docs.temporal.io/nexus — cross-team/namespace topology
- https://docs.temporal.io/self-hosted-guide — self-host

Camunda:
- https://docs.camunda.io/docs/reference/licenses/ — component-by-component license terms (verified)
- https://camunda.com/blog/2024/04/licensing-update-camunda-8-self-managed/ — 8.6 production-license change
- https://forum.camunda.io/t/important-licensing-changes-to-camunda-8-self-managed/51669 — community impact
- https://docs.camunda.io/docs/reference/announcements-release-notes/890/890-release-notes/ — 8.9 features/Tasklist V2
- https://camunda.com/blog/2025/02/camunda-7-enterprise-end-of-life-extension/ — C7 CE EOL Oct 2025, EE to 2030
- https://camunda.com/blog/2020/08/how-cmmn-never-lived-up-to-its-potential/ — CMMN dropped rationale

Kogito / jBPM / Apache KIE:
- https://kie.apache.org/components/jbpm/ and https://kie.apache.org/components/kogito/ — project status
- https://kie.apache.org/docs/10.0.x/kogito/ — docs (incubating)
- https://github.com/apache/incubator-kie-kogito-examples — examples/human tasks

Flowable:
- https://www.flowable.com/open-source — Apache-2.0 engines
- https://www.flowable.com/solutions/cmmn — CMMN case management
- https://github.com/flowable/flowable-engine — source

Other durable-execution engines:
- https://www.pkgpulse.com/guides/hatchet-vs-trigger-dev-v3-vs-inngest-durable-workflows-2026 — Hatchet/Inngest
- https://www.pkgpulse.com/guides/inngest-vs-trigger-dev-v3-vs-restate-2026 — Restate (BUSL)
- https://news.ycombinator.com/item?id=42821705 — Restate BUSL-1.1 confirmation
- https://www.tiarebalbi.com/en/blog/dbos-vs-temporal-postgres-durable-execution — DBOS
- https://www.inngest.com/compare-to-temporal — Inngest
- https://conductor-oss.github.io/conductor/devguide/faq.html and https://orkes.io/compare/orkes-conductor-vs-temporal — Conductor/Orkes
- https://www.cncf.io/announcements/2026/03/23/general-availability-of-dapr-agents-delivers-production-reliability-for-enterprise-ai/ and https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-overview/ — Dapr Workflows/Agents
- https://aws.amazon.com/blogs/migration-and-modernization/replacing-netflix-conductor-with-aws-step-functions-what-we-learned/ — Step Functions

Declarative DSL over durable engine (prior art):
- https://serverlessworkflow.io/ and https://gillesbarbier.medium.com/understanding-the-serverless-workflow-1-0-dsl-6e874a1fd511 — CNCF Serverless Workflow
- https://temporal.io/code-exchange/temporal-dsl — official Temporal SWF-DSL sample
- https://zigflow.dev/articles/why-i-built-a-yaml-dsl-for-temporal-workflows/ and https://simonemms.com/blog/2026/02/02/zigflow-the-missing-temporal-dsl — Zigflow (YAML DSL → Temporal)
- https://medium.com/@nareshvenkat14/dsl-based-workflow-orchestration-part-1-introduction-architecture-9d0112f77e00 — layered interpreter architecture
