# 06 — Brownfield Migration & Progressive Developer/User Experience

> Research brief for **ichiflow**, an AI-native enterprise workflow development framework.
> Scope: two adoption pillars — **(A) brownfield migration onto existing enterprise data** (run against legacy DBs with minimal schema change; AI-assisted mapping/migration/verification baked into the framework), and **(B) progressive DX** (a newcomer ships a policy/rules system in minutes; the same framework scales to enterprise deployment).
> **Author:** research agent · **Date:** 2026-07-12 · **Status:** draft for architecture review
> Versions, licensing, and project health verified against mid-2026 sources (URLs inline and in §Sources). Cross-refs to sibling briefs 01 (rule engines), 02 (orchestration), 04 (adapters/auth), 05 (audit/observability/deployment).

---
---

# PART A — BROWNFIELD MIGRATION ONTO EXISTING DATA

## A.0 Executive summary & recommendation

Enterprises that adopt ichiflow already run mission-critical systems on databases with years of data, foreign keys, triggers, and downstream consumers ichiflow will never see. The single most important design stance is therefore:

> **Adopt into the existing database; do not demand a migration to run.** ichiflow's default posture must be a **non-invasive overlay**: read (and where sanctioned, write) the legacy schema through a **declarative schema-mapping layer** that projects legacy tables/columns onto ichiflow's canonical domain schema, with **zero or additive-only DDL** on day one. Structural change is a later, opt-in, *assisted* step — never a precondition.

Three concentric rings, adopted in order:

1. **Ring 0 — Map, don't migrate (default).** A declarative mapping DSL binds legacy tables/columns → canonical ichiflow entities. Backed at runtime by read models (views / federated queries), so the legacy DB stays the source of truth. This is the anti-corruption layer (ACL) from DDD, realized as data rather than code, and is the same "declare, don't code" meta-principle as brief 04.
2. **Ring 1 — Coexist & sync (transition).** When ichiflow must own some state, use **expand/contract (parallel change)** schema evolution plus **CDC (Debezium)** to keep legacy and ichiflow stores consistent, and the **transactional outbox** pattern to publish canonical events without the dual-write hazard. Strangler-fig routing shifts slices of behavior over time.
3. **Ring 2 — Assisted structural migration (opt-in).** Where new columns/tables are genuinely unavoidable, ichiflow's **Migration Copilot** (an agent/skill shipped *inside* the framework) introspects the legacy DB, proposes canonical mappings, generates an **expand/contract migration plan**, and generates **reconciliation + parity verification tests** — all behind hard human-approval and dry-run guardrails.

**Tooling recommendation:** standardize the framework's own migrations on **Atlas (ariga)** as the declarative schema-as-code engine (it lints for destructive/lock/backward-incompatible changes and drives expand/contract) and **pgroll** as the zero-downtime executor on PostgreSQL; keep **Flyway Community** as the plain-SQL fallback adopters already trust. Use **Trino** for read-time federation when data must not move, and **Debezium** for CDC when it must sync. Ship the Migration Copilot as an *assistant over these deterministic tools*, never as a code generator that writes directly to production. The LLM proposes; Atlas/pgroll plan and lint; a human approves; a shadow/parity harness verifies.

**Non-negotiable guardrails (what mature tools do, and ichiflow must copy):** human approval gate, dry-run/plan preview, migration linting for destructive changes, shadow-read comparison (old vs new outputs), row-count/checksum/sampling reconciliation, and — uniquely important for a *rules* framework — **decision parity testing** (legacy decisions vs migrated DMN rules over a golden dataset). See §A.6.

---

## A.1 The core stance: map first, migrate last

### A.1.1 Why "minimal schema change" is the right default

Every schema change to a legacy production DB is a coordinated, high-blast-radius event: it touches other applications, ETL jobs, reports, and DBA change-control. The classic warning is that **the shared database is the worst integration point** — it couples systems through their most volatile internal detail. ichiflow's value proposition ("adopt in minutes, at enterprise scale") collapses if step one is "alter your loan_applications table." So the framework must be able to run against an *unmodified* legacy schema and earn the right to change it later.

### A.1.2 Anti-Corruption Layer (ACL), realized as a mapping DSL

DDD's **Anti-Corruption Layer** is "a translator at the border, converting the legacy system's messy dialect into the clean language of the new domain model" ([Microsoft Learn — ACL](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer)). ichiflow should implement the ACL as a **declarative schema-mapping artifact**, not hand-written translator code:

```yaml
# ichiflow canonical entity  <-  legacy binding (illustrative)
entity: LoanApplication
source:
  table: LOAN_APPS            # legacy Oracle table, untouched
  primaryKey: APP_ID
fields:
  id:            { from: APP_ID }
  applicantName: { from: [FNAME, LNAME], transform: "concat($FNAME,' ',$LNAME)" }
  status:        { from: STAT_CD, valueMap: { A: APPROVED, D: DENIED, P: PENDING } }
  amount:        { from: LOAN_AMT, type: money(currency=CCY_CD) }
readModel: view          # materialize as a DB view / federated query
writePolicy: read-only   # explicit; writes require an approved plan
```

Properties this buys:
- **Introspectable & AI-authorable** — the mapping is data an agent can propose and a human can diff (same rationale as brief 04's AsyncAPI/OpenAPI contracts).
- **Value transforms + code-table normalization** live in one place (`STAT_CD` legacy codes → canonical enums), which is exactly what enterprise legacy data needs.
- **Explicit write policy** — the default `read-only` keeps Ring 0 non-invasive; upgrading to `read-write` is a governed decision.

### A.1.3 Strangler Fig as the program shape

The **Strangler Fig** pattern wraps the legacy system and migrates behavior slice-by-slice behind a facade/gateway until the old system is "strangled" and retired, preserving uptime ([AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html); [Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig)). For ichiflow this means: a workflow/decision slice (e.g., "hardship-flag routing") is implemented in ichiflow first as a shadow, then promoted to authoritative, one slice at a time — never a big-bang rewrite. The primary risk the literature flags is **data consistency during the coexistence phase**, which is what Ring 1 (CDC + outbox + expand/contract) exists to manage.

### A.1.4 Pattern catalog — brownfield integration (tradeoffs)

| Pattern | What it gives ichiflow | Tradeoff / risk | ichiflow verdict |
|---|---|---|---|
| **Schema-mapping / ACL (declarative)** | Run on unmodified legacy schema; canonical model isolated from legacy warts | Mapping maintenance; leaky transforms; runtime translation cost | **Core Ring 0.** The default adoption path. |
| **Data virtualization / federation** (Trino, Teiid) | Query legacy + new stores in one SQL/view without moving data | Query pushdown limits; latency; another cluster to run | **Ring 0 read models** when data can't move. Trino primary; Teiid only in Red Hat shops. |
| **Auto-API over legacy DB** (Hasura, PostgREST, DreamFactory) | Instant read/write API surface over a legacy schema | Exposes raw schema (leaks legacy model unless masked); GraphQL-first tools weak on REST/legacy | Tactical adapter, not the canonical layer; wrap behind the ACL. |
| **CDC** (Debezium) | Keep legacy ↔ ichiflow stores in sync during transition | Operational weight (Kafka/Connect); initial-snapshot cost; schema-change handling | **Core Ring 1** sync mechanism. |
| **Expand/Contract (Parallel Change)** | Backward-compatible schema evolution with zero downtime | 3-phase discipline; must track all readers before contract | **Core Ring 2** evolution model. |
| **Transactional Outbox** | Atomic state-change + event publish; kills dual-write hazard | Extra table + relay; at-least-once (needs idempotent consumers) | **Core** whenever ichiflow writes + emits. |
| **Dual-write (write both stores in app code)** | Superficially simple | **Anti-pattern** — partial-failure inconsistency | **Avoid.** Use outbox + CDC instead. |
| **Strangler Fig + gateway routing** | Incremental, low-risk cutover | Coexistence-phase consistency; facade complexity | **Program shape** for the whole adoption. |
| **Shared DB as integration point** | Zero new infra | Tight coupling to volatile internals | **Avoid as a design**; tolerate only transiently. |

---

## A.2 Keeping legacy and new stores in sync

### A.2.1 CDC — Debezium health (2026)

Debezium is **healthy and the de-facto open-source CDC standard in 2026**. Current line is **Debezium 3.x** — 3.4.3.Final (Mar 2026) and **3.6 (Jul 2026)** — with active feature work: exactly-once semantics for core connectors, a community **CockroachDB** connector, improved PostgreSQL TOAST handling, MariaDB vector types, Oracle LogMiner resilience, and a **Debezium Platform** with native metrics/monitoring. The 2026 community survey reports **98.6% of respondents using or planning to use Debezium**, and it has shipped continuously since 2015 ([Debezium 3.6 summary](https://debezium.io/blog/2026/07/01/debezium-3-6-final-release/); [2026 survey](https://debezium.io/blog/2026/04/27/debezium-2026-survey-results/); ["What nobody explains about Debezium in 2026"](https://debezium.io/blog/2026/05/22/what-nobody-explains-about-debezium-2026/)). **Verdict: safe to standardize on.** Note the operational weight (Kafka Connect); for lighter cases, single-store CDC or the outbox relay may suffice.

A 2026 trend worth designing for: **"the database is becoming the event stream"** — modern Postgres/MySQL offer native change-streaming that streamlines the outbox relay, reducing the need for a full Kafka Connect fleet ([Conduktor](https://www.conduktor.io/blog/transactional-outbox-pattern-database-kafka)).

### A.2.2 Dual-write hazard → transactional outbox

The **dual-write problem**: writing to the DB and publishing an event as two separate steps means a crash between them leaves the two systems inconsistent ([AWS Prescriptive Guidance — Outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)). The **transactional outbox** writes the business change and an `outbox` row in **one transaction**; a relay (polling, or better, **CDC tailing the outbox table**) publishes downstream. CDC is now the standard relay, replacing polling ([Streamkap](https://streamkap.com/resources-and-guides/outbox-pattern-explained)). ichiflow should make outbox the built-in mechanism for any state-owning module, and treat "exactly-once" as *emulated* via idempotency keys + a dedup store (consistent with brief 04's delivery-semantics stance).

### A.2.3 Read-time federation (don't move the data)

When the enterprise forbids copying data, **Trino** federates queries across the legacy DB and ichiflow's store in a single SQL statement (e.g., join S3 logs with MySQL customer rows) with no replication; in 2026 it is the industry-standard distributed-SQL federation engine, ~3× the dev velocity of Presto, with fault-tolerant execution ([trino.io](https://trino.io/); [Cloudera](https://www.cloudera.com/blog/business/trino-the-federation-engine-powering-your-unified-data-fabric.html)). **Teiid** still exists (Red Hat Data Services / JBoss Data Virtualization) but is effectively Red-Hat-ecosystem-only in 2026; recommend Trino as primary, Teiid only where a customer is already invested. **Hasura/PostgREST** instantly expose a Postgres schema as GraphQL/REST with zero app code — useful as a *tactical adapter*, but Hasura is "less suitable for legacy integration" and GraphQL-first ([Hasura](https://hasura.io/graphql/database/postgresql); [integrate.io comparison](https://www.integrate.io/blog/best-auto-generated-rest-api-tools-for-databases/)). Wrap any auto-API behind the ACL so the raw legacy model doesn't leak into ichiflow's domain.

---

## A.3 Schema evolution: expand / contract (parallel change)

The safe way to make a breaking schema change without downtime is **Parallel Change / Expand-Contract** ([Martin Fowler](https://martinfowler.com/bliki/ParallelChange.html); [Prisma Data Guide](https://www.prisma.io/dataguide/types/relational/expand-and-contract-pattern)):

1. **Expand** — additive-only DDL: add new column/table, backfill in the background, keep old + new side by side. All changes backward-compatible.
2. **Migrate/transition** — write both old and new formats; gradually move readers to the new shape.
3. **Contract** — once no reader/writer depends on the old shape, remove it.

This is the schema-change discipline ichiflow's Migration Copilot must *generate* (never a bare `ALTER ... DROP`). It's also exactly what **pgroll** automates natively on PostgreSQL (§A.4).

---

## A.4 Migration tooling — named tools, 2026 status

| Tool | 2026 status & licensing | Fit for ichiflow |
|---|---|---|
| **Flyway** (Redgate) | Community edition free/OSS; **Teams tier discontinued for new customers (May 2025)** — rollback, drift, code analysis moved to paid **Enterprise** ([Bytebase comparison](https://www.bytebase.com/blog/flyway-vs-liquibase/)). | Keep **Flyway Community** as the plain-SQL, adopter-familiar fallback. Don't depend on Teams/Enterprise features. |
| **Liquibase** | **Community moving to Functional Source License (FSL) at v5.0** — *not* OSI-open-source; reverts to Apache-2.0 two years after each release. Controversial; Keycloak and others flagged it ([BigGo](https://biggo.com/news/202510161313_Liquibase_License_Controversy); [Liquibase blog](https://www.liquibase.com/blog/liquibase-community-for-the-future-fsl); [keycloak#43391](https://github.com/keycloak/keycloak/issues/43391)). | **Avoid as a core dependency** — the license change is a lock-in/rug-pull signal counter to ichiflow's "no lock-in" mandate. |
| **Atlas (ariga)** | Active **open-core** (OSS + commercial). Declarative, **schema-as-code** (SQL/HCL/ORM); **50+ safety analyzers** (destructive change, table locks, backward-incompatible, data-dependent); versioned + declarative (Terraform-like) workflows; broad DB support incl. Postgres/MySQL/SQL Server/Oracle/Snowflake ([atlasgo.io](https://atlasgo.io/); [GitHub](https://github.com/ariga/atlas)). | **Recommended core engine** for ichiflow's own migrations + the Copilot's linting/planning backbone. Watch the open-core boundary. |
| **pgroll** (Xata) | OSS, Go **single binary**, Postgres 14+; implements **expand/contract via virtual schemas** (views expose old+new versions simultaneously), automatic background backfill, reversible ([pgroll.com](https://pgroll.com/); [GitHub](https://github.com/xataio/pgroll); [expand/contract blog](https://xata.io/blog/pgroll-expand-contract)). | **Recommended zero-downtime executor** on Postgres — directly realizes §A.3. |
| **Reshape** | The OSS predecessor that *inspired pgroll*; less active. | Prefer pgroll. |
| **Prisma Migrate / Drizzle Kit** | The two dominant TS ORMs in 2026; both mature. Prisma = polished `prisma migrate` + introspection; Drizzle = leaner, near-zero runtime overhead ([Prisma vs Drizzle 2026](https://ecosire.com/blog/drizzle-orm-vs-prisma-2026-comparison)). | TS-edge migration + **DB introspection** (Prisma `introspect` / Drizzle pull) to seed canonical schemas from a legacy DB. |
| **jOOQ / Exposed** (Kotlin/JVM) | jOOQ's **code generator reverse-engineers a live DB** into typed schema objects — a natural canonical-schema seeder on the JVM side; Exposed is JetBrains' Kotlin SQL DSL. | JVM-side introspection + typed access for the Kotlin integration/rules workers (brief 01/02). |
| **pgloader** | Mature bulk loader (e.g., SQLite→Postgres) with schema mapping/type casting. | One-shot bulk data moves during cutover. |

**Reverse-engineering / introspection is a first-class capability, not an afterthought.** ichiflow should ship an introspector (jOOQ codegen on JVM, Prisma/Drizzle pull on TS, Atlas `inspect` cross-DB) that generates a *draft canonical schema + draft mapping* FROM the existing DB. This is the deterministic substrate the Migration Copilot reasons over.

---

## A.5 AI-assisted schema mapping & migration planning — state of the art (2026)

### A.5.1 Research

LLM-based **schema matching** is an active 2025–26 research area, converging on **hybrid small-LM + large-LM, multi-stage** pipelines to beat context-length and cost limits:
- **Magneto** (VLDB 2025) — combines small + large LMs for schema matching.
- **Schemora** (2025) — multi-stage recommendation + metadata enrichment with off-the-shelf LLMs ([arXiv 2507.14376](https://arxiv.org/pdf/2507.14376)).
- **"Towards Scalable Schema Mapping using LLMs"** (2025) — notes LLMs are **sensitive to input structure**, yet most matchers use static prompts ([arXiv 2505.24716](https://arxiv.org/pdf/2505.24716)).
- **ConStruM** — structure-guided, context-aware schema matching ([arXiv](https://arxiv.org/pdf/2601.20482)).
- **SERI 2026 — "Schema Matching for Enterprises using Generative AI"**: an ICSE-2025 SLM/LLM multi-stage matcher, extended in EDBT 2026 to **fine-tune SLMs with limited data for enterprise deployment** ([SERI 2026](https://conf.researchr.org/details/seri-2026/seri-2026-seri-2026/3/Schema-Matching-for-Enterprises-using-Generative-AI)).

**Takeaway for ichiflow:** LLMs are strong at *proposing* candidate column→field matches and value-code mappings using domain terminology, but must be treated as *recommenders* whose output is ranked, human-reviewed, and verified — never trusted blindly. Prefer a **retrieval-augmented, multi-stage** design (candidate generation → LLM ranking → human confirm) over stuffing whole enterprise schemas into a prompt.

### A.5.2 Commercial AI migration assistants (what "good" looks like)

- **AWS DMS Schema Conversion + GenAI** — uses **Amazon Bedrock LLMs (Claude Sonnet 4.5 / 4.6)** to convert **up to ~90%** of schema/code (incl. complex procedures/functions traditional rule engines can't), Oracle/SQL Server/MySQL/PostgreSQL/Sybase → Aurora/RDS PostgreSQL; expanded to 9 more regions in Mar 2026 ([AWS blog](https://aws.amazon.com/blogs/aws/aws-data-migration-service-improves-database-schema-conversion-with-generative-ai/); [What's New Mar 2026](https://aws.amazon.com/about-aws/whats-new/2026/03/aws-dms-schema-conversion-with-genai/)).
- **Google Database Migration Service + Gemini** (Oracle→PostgreSQL/AlloyDB, in preview→GA'ing) — converts stored procedures/triggers/functions, and crucially ships **explainability** ("why was it converted this way?", "how do I fix this issue?"), **learns from the human's manual edits** to fix other objects, and **assesses functional equivalence** of converted code ([Google Cloud blog](https://cloud.google.com/blog/products/databases/gemini-helps-migrate-oracle-to-postgresql-on-google-cloud); [DMS + Gemini docs](https://docs.cloud.google.com/database-migration/docs/oracle-to-postgresql/code-conversion-with-gemini)).
- **Data-integration vendors** — Integrate.io/Informatica/Talend/Fivetran offer **AI auto-mapping of fields**; Fivetran does automatic schema-change handling; Airbyte pairs Debezium CDC with AI connector suggestions ([integrate.io — AI ETL](https://www.integrate.io/blog/ai-etl-tools/)). Market note: **Salesforce acquired Informatica ($8B, closed Nov 2025)**; **Talend Open Studio (free) was discontinued Jan 2024** (Qlik) — both reinforce the anti-lock-in argument for building ichiflow's mapping as open, portable data.

**Common guardrail DNA across all mature tools** (ichiflow must match): a **workspace** where AI proposes, a **human reviews/edits** every object, **explainability** for each proposed change, **learning from human corrections**, an **assessment/functional-equivalence** step, and **conversion never applied straight to production** — it lands in a reviewable target first.

### A.5.3 Proposed design — ichiflow **Migration Copilot** (agent/skill inside the framework)

A framework-native capability (a "skill" the ichiflow CLI/agent exposes) that turns a legacy DB into a governed ichiflow adoption. **The LLM proposes; deterministic tools plan and lint; a human approves; a harness verifies.** Pipeline:

```
┌─ 1. INTROSPECT ───────────────────────────────────────────────┐
│ Deterministic reverse-engineering (Atlas inspect / jOOQ gen /  │
│ Prisma pull) → legacy schema graph + profiling stats           │
│ (row counts, distinct code values, null rates, FK graph).      │
└───────────────────────────────────────────────────────────────┘
        │
┌─ 2. PROPOSE MAPPINGS (AI, RANKED) ────────────────────────────┐
│ Multi-stage schema matcher: candidate gen (name/type/embedding │
│ similarity) → LLM ranks & explains → emits DRAFT mapping DSL   │
│ (§A.1.2) + confidence + rationale per field. Low-confidence &  │
│ ambiguous fields flagged for human.                            │
└───────────────────────────────────────────────────────────────┘
        │
┌─ 3. HUMAN REVIEW GATE (BLOCKING) ─────────────────────────────┐
│ Side-by-side diff UI; approve/edit/reject each mapping.        │
│ Nothing proceeds without sign-off. Decisions recorded to the   │
│ append-only DecisionRecord (brief 05) for audit.               │
└───────────────────────────────────────────────────────────────┘
        │
┌─ 4. PLAN MIGRATION (AI-drafted, tool-validated) ──────────────┐
│ If DDL needed: generate an EXPAND/CONTRACT plan; hand to Atlas │
│ (lint: destructive/lock/backward-incompat) + pgroll (execute). │
│ DRY-RUN preview mandatory. Plan is reversible.                 │
└───────────────────────────────────────────────────────────────┘
        │
┌─ 5. GENERATE VERIFICATION (AI-drafted, deterministic-run) ────┐
│ Auto-generate: row-count/checksum/sampling reconciliation      │
│ (data), shadow-read comparisons, and — for rules — DECISION    │
│ PARITY tests (legacy outcome vs migrated DMN) over a golden    │
│ dataset. See §A.6.                                             │
└───────────────────────────────────────────────────────────────┘
        │
┌─ 6. SHADOW / CANARY CUTOVER ──────────────────────────────────┐
│ Strangler routing: run ichiflow in shadow, compare, then       │
│ canary %, then authoritative. Contract only after parity holds.│
└───────────────────────────────────────────────────────────────┘
```

**Copilot guardrails (hard requirements):**
1. **Human approval gate** on every mapping and every DDL plan — AI output is a *proposal*, not an action.
2. **Dry-run / plan preview** before any write; **reversible** plans (pgroll/Atlas).
3. **Migration linting** — Atlas's 50+ analyzers block destructive/locking/backward-incompatible changes by default.
4. **Read-only by default** — Ring 0 never writes legacy tables; write access is an explicit governed upgrade.
5. **Shadow-read + reconciliation** must pass before promotion (§A.6).
6. **Explainability + provenance** — every proposal carries a rationale and confidence; every human decision is logged to the append-only DecisionRecord (brief 05) so an auditor can answer "why was this column mapped this way / this migration approved."
7. **Never touch production directly** — Copilot outputs land in a reviewable workspace / non-prod target first (the AWS/Google pattern).

---

## A.6 Data & decision migration verification

Verification is doubly important for ichiflow because it migrates **both data and decision logic**.

### A.6.1 Data reconciliation

Standard, well-established techniques the framework should generate automatically ([Datafold — prove parity](https://www.datafold.com/data-migration-guide/validate-prove-parity/); [Airbyte — validate integrity](https://airbyte.com/data-engineering-resources/validate-data-integrity-after-migration)):
- **Row counts** at DB/schema/table level, timestamped for post-cutover reconciliation.
- **Checksums / hash totals** (e.g., SHA-256) for corruption detection.
- **Aggregate comparisons** on key numeric/financial fields.
- **Row-level cross-DB diffing** with **sampling** for very large tables (checksum-tree algorithms compare 100M rows in seconds).
- Coverage beyond happy path: nulls, special chars, edge cases, code-table values.

**Tool note:** **Datafold's open-source `data-diff` is EOL — no longer actively developed/supported since May 2024**; cross-DB diffing lives on only in Datafold Cloud ([sunsetting post](https://www.datafold.com/blog/sunsetting-open-source-data-diff/)). So ichiflow should **build a first-party reconciliation harness** (checksum-tree + sampling) rather than depend on the abandoned OSS lib — and it can generate the reconciliation SQL via the Copilot.

### A.6.2 Shadow traffic / dark launch (behavioral parity)

**Shadow testing** runs the new system in parallel on live production traffic while the legacy system stays the source of truth; outputs are compared to catch discrepancies in logic/data/performance *before* cutover ([Microsoft Eng Playbook — Shadow Testing](https://microsoft.github.io/code-with-engineering-playbook/automated-testing/shadow-testing/); [InfoQ — shadow table strategy](https://www.infoq.com/articles/shadow-table-strategy-data-migration/)). A **dark launch** routes traffic through new code paths but hides results from users. The canonical library prior art is **GitHub's Scientist** — run legacy + candidate simultaneously, serve the trusted result, and record mismatches. Combined flow: legacy stays live → gateway shadows traffic → compare → canary ramp → full cutover only after **parity + SLO** hold ([Towards Dev — strangler/parallel-run](https://medium.com/towardsdev/modernising-enterprise-systems-without-breaking-production-strangler-fig-parallel-run-and-38bd49a812e5)). ichiflow should ship a **Scientist-style "experiment" primitive** as a first-class feature.

### A.6.3 Decision parity (the rules-specific angle)

When legacy decision logic (COBOL, PL/SQL, spreadsheets, an old rules engine) is migrated to ichiflow's **DMN** rules (brief 01), correctness = **outcome parity**, not schema parity. Approach:
- Build a **golden dataset** of historical cases with known legacy outcomes.
- Replay through migrated DMN; **compare decisions** (approve/deny/route + reason codes), not just aggregates. This is "business-rules validation… confirm the business logic produces the same results against both datasets" ([dbseer](https://dbseer.com/blog/data-migration-validation-how-to-prove-accuracy-completeness-and-parity/)).
- Express expectations as **Gherkin parity scenarios** (recent legacy-modernization research uses parity specs + Gherkin as migration guides ([arXiv 2605.18684](https://arxiv.org/pdf/2605.18684))), and run continuously as regression tests.
- Feed mismatches back into rule authoring — a mismatch is either a migration bug *or* a discovered legacy quirk to codify deliberately.
- Tie every decision to the **DecisionRecord** provenance chain (brief 05) so parity results are auditable.

This decision-parity harness is a **differentiating ichiflow feature**: it's the safety net that makes "migrate your rules to ichiflow" a defensible enterprise proposition.

---

## A.7 Part A risks

1. **Legacy DB is often not clean** — orphaned FKs, overloaded columns, encoded business logic in triggers/defaults. Mapping + introspection surfaces this but can't fully automate resolution; budget human data-archaeology.
2. **AI schema-matching false confidence** — plausible-but-wrong mappings are the top hazard; mitigate with ranked candidates, confidence thresholds, mandatory review, and parity verification (never auto-apply).
3. **CDC operational weight** — Debezium/Kafka Connect is real infra; offer a lighter native-CDC / outbox-relay path for smaller adopters.
4. **Coexistence-phase consistency** — the strangler's hardest problem; expand/contract + outbox + idempotent consumers are the mitigations, but the transition window is where incidents cluster.
5. **Open-core / license drift** — Atlas is open-core; Liquibase went FSL; Talend Open Studio and Datafold OSS died. Keep every migration artifact as **portable, plain data** (SQL + declarative mapping) so ichiflow can swap the engine underneath.
6. **Write-back to legacy** — the moment ichiflow writes legacy tables it inherits their constraints and other consumers; keep read-only as long as possible and gate write access hard.

---
---

# PART B — PROGRESSIVE DEVELOPER/USER EXPERIENCE

## B.0 Executive summary & recommendation

ichiflow must satisfy two audiences with one framework: a newcomer who wants a working policy/rules app **in under 10 minutes**, and an enterprise that needs SSO, HA, zones, audit retention, and compliance. The failure mode to avoid is **Backstage's** — a powerful platform whose onboarding is so heavy (6–18 months, ~10% adoption) that only its author's org succeeds ([Roadie](https://roadie.io/blog/platform-engineering-in-2026-why-diy-is-dead/); [Riftmap](https://riftmap.dev/blog/backstage-alternatives/)). The model to emulate is **Temporal / Supabase / Rails**: a single-binary/one-command local start, opinionated batteries-included defaults, and a smooth ramp where enterprise capability is *added by configuration, not by forking the programming model*.

**Recommendation — three levers:**

1. **Time-to-first-success < 10 min via a single dev binary.** Ship `ichiflow dev` as a **Temporal-CLI-style single process with an embedded SQLite store** that boots in seconds — no Docker required for hello-world — plus an optional `docker compose` full stack for realism. The newcomer scaffolds a rules app, runs it, and sees a decision execute, all locally.
2. **Graduated tiers as config, not code rewrites.** A **SQLite→Postgres→distributed** persistence ladder and **embedded→HA** deployment ladder, both selected by config/profile. "Batteries included but swappable": Postgres-first defaults (brief 05) with SPIs so the *same app code* runs from laptop to cluster. Enterprise features (SSO, audit retention, zones, compliance packs) are **additive layers**, never a different SDK.
3. **AI-assisted kickstart + domain templates.** Ship domain starter templates ("loan origination", "insurance claims", "KYC review") AND an **interview-style bootstrap agent** that turns a natural-language description into a draft schema + rules + flow scaffold the user then refines.

---

## B.1 Onboarding benchmarks — what makes TTFS < 10 minutes

| Platform | Local-start mechanism | Onboarding lesson |
|---|---|---|
| **Temporal** | `temporal server start-dev` — **single binary, zero deps, SQLite/in-memory, boots in ~2s, Web UI on :8233** ([docs](https://docs.temporal.io/develop/run-a-development-server); [Temporalite blog](https://temporal.io/blog/temporalite-the-foundation-of-the-new-temporal-cli-experience)) | **Single binary beats docker-compose.** Compose adds "overhead and indirection that slows development." This is the gold standard ichiflow should copy. |
| **Supabase** | `supabase init` + `supabase start` — two commands bring up the **full stack locally via Docker** (Postgres, Auth, Storage, Studio) ([docs](https://supabase.com/docs/guides/local-development/cli/getting-started)) | Full-stack fidelity locally, but **first run is slow (Docker image pulls)** and needs Docker/Node — a friction tax. Great for realism, weaker for the absolute-fastest first success. |
| **Rails / Laravel** | `rails new` + scaffold generators → CRUD in minutes | **Convention over configuration** + scaffolding: opinionated defaults eliminate decisions; "generate a complete CRUD interface in minutes" ([rubyonrails.org](https://rubyonrails.org/)). The productivity engine ichiflow's DSL scaffolder should mirror. |
| **create-t3-app / create-*-app** | One CLI, pick optional modules, typed defaults ([GitHub](https://github.com/t3-oss/create-t3-app)) | "Solve the boring parts" (auth, API, DB) so the user writes only domain logic. **Modular scaffold with sensible defaults.** |
| **Keycloak** | `start-dev` — one command, dev defaults, :8080; realm = tenant ([keycloak.org](https://www.keycloak.org/getting-started/getting-started-zip)) | Explicit **dev-mode vs prod-mode** split with "convenient (insecure) defaults" for dev — a clean tiering precedent. |
| **Backstage** (counter-example) | Heavy: months to a usable instance, dedicated team ([Roadie](https://roadie.io/blog/from-day-0-to-day-2-a-guide-to-planning-and-implementing-backstage/)) | **The anti-pattern.** Power without a fast on-ramp → ~10% adoption, maintenance burnout. ichiflow must not require a platform team to say hello-world. |

**Synthesis — the TTFS < 10 min recipe:** (1) a **single self-contained binary** with an embedded store as the *default* dev mode (Docker optional, not required); (2) **convention over configuration** — one obvious way, opinionated defaults; (3) **scaffolding** that generates a runnable rules/flow app, not an empty project; (4) **instant feedback** — a local UI showing the decision/flow execute; (5) **explicit dev-vs-prod modes** so dev defaults can be convenient without being production-unsafe.

---

## B.2 Tiering / "graduated complexity" patterns

The organizing principle (aligned with brief 05's "Postgres-first, pluggable-later"): **one programming model, swappable substrates, additive enterprise layers.** The app code a newcomer writes must be *unchanged* when it runs at enterprise scale.

### B.2.1 Persistence ladder — SQLite → Postgres → distributed

- **Rung 1 (dev):** embedded **SQLite** in the single binary (Temporal's dev-server model). Zero infra.
- **Rung 2 (default prod):** **PostgreSQL** — case data + audit + read models + queue in one instance (brief 05's default). `pgloader` handles the one-time SQLite→Postgres promotion if ever needed.
- **Rung 3 (scale):** pluggable via SPIs — audit → append-only ledger, search → OpenSearch, analytics → warehouse, without forking (brief 05 §4).
- **Distributed-store options** in the ecosystem to keep the model coherent: **DBOS** (durable workflows as a *lightweight Postgres-backed library* — "Postgres is enough", TS/Python/Go/Java, ripe by 2026 ([dbos.dev](https://dbos.dev/); [DBOS vs Temporal 2026](https://www.tiarebalbi.com/en/blog/dbos-vs-temporal-postgres-durable-execution))); **libSQL/Turso** and **LiteFS** for distributed-SQLite; **NATS** for embedded→distributed messaging. The lesson: pick substrates that offer their *own* embedded→distributed ladder so ichiflow's tiers nest cleanly.

### B.2.2 Deployment ladder — embedded → HA → zones

- **Single binary** (dev) → **modular monolith on one Postgres** (default prod, brief 05 §3 / Spring Modulith) → **split modules / HA / DMZ-intranet zones** (enterprise, brief 05 §5). Because module boundaries are async-first from day one, splitting later doesn't rewrite app logic.

### B.2.3 "Batteries included but swappable"

Ship **opinionated defaults that just work** (Postgres, built-in outbox, built-in audit, a default rule engine) but expose **SPIs/adapters** (brief 04) so every default is replaceable without touching the programming model. This is the Rails/Supabase "batteries included," tempered with the pluggability enterprises demand.

### B.2.4 Feature flags / config layers separate starter from enterprise

Enterprise capability should be gated by **configuration and feature flags**, not code branches or a forked SDK. Feature-flag platforms (Unleash et al.) show flags double as **compliance controls** — SSO-integrated access, SCIM provisioning, and **audit-logged config changes** replace slow deployment gates while satisfying SOC 2 auditors ([Unleash — SOC 2](https://www.getunleash.io/blog/soc-2-how-feature-flags-can-help-achieve-compliance)). ichiflow should express tier differences (zone separation, HA, multi-DB, retention windows) as **config/profiles** so moving from starter to enterprise is a settings change, verified and auditable, not a migration.

---

## B.3 Template/starter ecosystem + AI-assisted kickstart

### B.3.1 Domain templates

Low-code/BPM vendors ship **domain accelerators** — Openkoda offers Claim Management / Policy Management / underwriting templates; OutSystems-based LOS covers the full loan journey; platforms bundle KYC flows, credit-bureau checks, and decision paths as configurable starters with built-in audit trails ([Openkoda](https://openkoda.com/best-insurance-low-code-platforms/); [Datamatics LOS](https://www.datamatics.com/resources/case-studies/demos/loan-origination-system-demo); [Newgen](https://newgensoft.com/resources/article/how-low-code-platforms-are-redefining-financial-services-software-development/)). **ichiflow should ship first-party domain templates** — `loan-origination`, `insurance-claims`, `kyc-review` — each a runnable bundle of canonical schema + DMN rule set + workflow + human-task queues + audit config. These are simultaneously the fastest on-ramp *and* the best documentation of "how you're meant to build."

### B.3.2 AI-assisted bootstrap (2026 state of the art)

2026 tooling turns **natural language → runnable scaffold**. "Semantic scaffolding": generators whose input is plain English, incorporating domain context ("generate a service that calculates tax for US customers, factoring tariffs"); tools like Refine AI generate production-ready CRUD scaffolds (pages, routing, auth, data-fetching) from a description or an API/data model ([Medium — Semantic Scaffolding](https://medium.com/@smithmr8/the-machine-learned-our-language-6dc1f33f5286); [Figma — AI app builders](https://www.figma.com/resource-library/ai-app-builders/)). Best practice for quality output: be specific about entities, relationships, and field constraints.

**Proposed ichiflow capability — the "Domain Modeling Copilot" (interview agent):** an agent/skill that *interviews a business user* ("What decisions does this process make? What data do you already store? Who reviews exceptions?") and emits a **draft domain model**: canonical entities, a DMN rule skeleton, a workflow with human-task steps, and — critically — **wiring to the Migration Copilot** (Part A) when the user already has a legacy DB. This is the front-door counterpart to Part A's back-door: one produces a greenfield scaffold from a conversation, the other maps an existing DB; both converge on the same canonical model. Guardrails mirror Part A: the agent **proposes a reviewable draft**, the human edits/approves, nothing is treated as authoritative logic until confirmed and (for rules) parity-tested.

### B.3.3 What "enterprise tier" adds — without changing app code

Delivered as additive config/infra layers on the same programming model (the WorkOS/enterprise-readiness pattern ([WorkOS](https://workos.com/blog/enterprise-readiness-checklist-2026))):
- **SSO / SAML / OIDC + SCIM** provisioning (pluggable auth SPI, brief 04) — swap dev's local users for the enterprise IdP by config.
- **Audit retention & immutability** — flip audit sink from Postgres to append-only ledger via SPI (brief 05); set retention windows by policy.
- **HA / multi-node / independent scaling** — deployment profile change, not code (brief 05 §3).
- **Zone separation (DMZ/intranet, air-gap)** — deployment topology + async relay (brief 05 §5).
- **Compliance packs** — pre-built config bundles (audit fields, retention, access policies, adverse-action/GDPR Art. 22 decision provenance) toggled per regulated vertical.

The test of success: **the loan-origination app a solo developer built on the SQLite dev binary deploys to a zoned, SSO'd, HA enterprise cluster with only config and infra changes — zero application-code edits.**

---

## B.4 Part B risks

1. **Two-audience tension** — optimizing TTFS can produce toy defaults that don't scale, or enterprise-grade defaults too heavy for newcomers. Mitigate with the explicit dev-vs-prod mode split (Keycloak/Temporal precedent) and a true config-only ramp.
2. **Docker-as-friction** — requiring Docker for hello-world costs the first-10-minutes win (Supabase's slow first run). Keep the *default* dev mode a single binary with embedded SQLite; Docker optional for full-stack fidelity.
3. **Template rot & "escape hatch" cliffs** — scaffolds/templates that can't be safely customized become dead weight (the create-app critique). Templates must be *ejectable* and idiomatic, not magic.
4. **AI bootstrap over-promising** — NL→scaffold can generate plausible-but-wrong domain models; treat output as a *draft* requiring human confirmation and, for rules, parity tests (same guardrail as Part A).
5. **Backstage trap** — if enterprise features leak into the core programming model, newcomers pay the complexity tax up front and adoption stalls at ~10%. Keep enterprise strictly additive.
6. **Config sprawl** — many profiles/flags become their own complexity; govern with sensible profile presets (dev / prod-single / enterprise) rather than exposing every knob.

---
---

# Cross-cutting synthesis

Parts A and B share one architecture and one guardrail philosophy:

- **One canonical domain model, reached two ways** — the **Migration Copilot** maps it *from* a legacy DB (brownfield back door); the **Domain Modeling Copilot** interviews it *into existence* (greenfield front door). Both feed the same schemas + DMN rules + flows.
- **AI proposes; deterministic tools + humans dispose** — every AI capability (schema matching, migration planning, NL scaffolding, rule generation) is a *recommender* behind human approval, dry-run, linting, and verification. This is the shared safety contract.
- **Declare, don't code; default, then swap** — mappings, migrations, tiers, and enterprise features are portable declarative data + config over swappable substrates, so ichiflow honors both "no lock-in" (Part A) and "one model, laptop to cluster" (Part B).
- **Provenance everywhere** — mapping decisions, migration approvals, and decision-parity results all land in the append-only DecisionRecord (brief 05), so every automated proposal is auditable.

---

# Sources

**Part A — patterns**
- Anti-Corruption Layer — https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer
- Strangler Fig — https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html · https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig
- Strangler + parallel run + gateway traffic modes — https://medium.com/towardsdev/modernising-enterprise-systems-without-breaking-production-strangler-fig-parallel-run-and-38bd49a812e5
- Expand/Contract (Parallel Change) — https://martinfowler.com/bliki/ParallelChange.html · https://www.prisma.io/dataguide/types/relational/expand-and-contract-pattern · https://xata.io/blog/pgroll-expand-contract
- Transactional Outbox / dual-write — https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html · https://streamkap.com/resources-and-guides/outbox-pattern-explained · https://www.conduktor.io/blog/transactional-outbox-pattern-database-kafka

**Part A — CDC & federation**
- Debezium 3.6 (Jul 2026) — https://debezium.io/blog/2026/07/01/debezium-3-6-final-release/
- Debezium 2026 survey — https://debezium.io/blog/2026/04/27/debezium-2026-survey-results/
- Debezium in 2026 — https://debezium.io/blog/2026/05/22/what-nobody-explains-about-debezium-2026/
- Trino — https://trino.io/ · https://www.cloudera.com/blog/business/trino-the-federation-engine-powering-your-unified-data-fabric.html
- Teiid — https://github.com/teiid/teiid
- Hasura / auto-APIs — https://hasura.io/graphql/database/postgresql · https://www.integrate.io/blog/best-auto-generated-rest-api-tools-for-databases/

**Part A — migration tooling (2026 status)**
- Flyway vs Liquibase 2026 — https://www.bytebase.com/blog/flyway-vs-liquibase/
- Liquibase FSL license change — https://biggo.com/news/202510161313_Liquibase_License_Controversy · https://www.liquibase.com/blog/liquibase-community-for-the-future-fsl · https://github.com/keycloak/keycloak/issues/43391
- Atlas (ariga) — https://atlasgo.io/ · https://github.com/ariga/atlas · https://atlasgo.io/atlas-vs-others
- pgroll — https://pgroll.com/ · https://github.com/xataio/pgroll · https://xata.io/blog/pgroll-schema-migrations-postgres
- Reshape — https://github.com/fabianlindfors/reshape
- Prisma vs Drizzle 2026 — https://ecosire.com/blog/drizzle-orm-vs-prisma-2026-comparison · https://orm.drizzle.team/docs/migrations
- pgloader (SQLite→Postgres) — https://pgloader.readthedocs.io/en/latest/ref/sqlite.html

**Part A — AI schema mapping / migration**
- SERI 2026 schema matching (enterprise GenAI) — https://conf.researchr.org/details/seri-2026/seri-2026-seri-2026/3/Schema-Matching-for-Enterprises-using-Generative-AI
- Towards Scalable Schema Mapping using LLMs — https://arxiv.org/pdf/2505.24716
- Schemora — https://arxiv.org/pdf/2507.14376
- ConStruM — https://arxiv.org/pdf/2601.20482
- AWS DMS Schema Conversion + GenAI — https://aws.amazon.com/blogs/aws/aws-data-migration-service-improves-database-schema-conversion-with-generative-ai/ · https://aws.amazon.com/about-aws/whats-new/2026/03/aws-dms-schema-conversion-with-genai/
- Google DMS + Gemini — https://cloud.google.com/blog/products/databases/gemini-helps-migrate-oracle-to-postgresql-on-google-cloud · https://docs.cloud.google.com/database-migration/docs/oracle-to-postgresql/code-conversion-with-gemini
- AI ETL / auto-mapping vendors; Informatica/Talend moves — https://www.integrate.io/blog/ai-etl-tools/ · https://technologymatch.com/blog/talend-vs-informatica-vs-fivetran-vs-dbt

**Part A — verification**
- Datafold prove parity — https://www.datafold.com/data-migration-guide/validate-prove-parity/
- Datafold OSS data-diff sunset — https://www.datafold.com/blog/sunsetting-open-source-data-diff/
- Airbyte validate integrity — https://airbyte.com/data-engineering-resources/validate-data-integrity-after-migration
- Shadow testing — https://microsoft.github.io/code-with-engineering-playbook/automated-testing/shadow-testing/ · https://www.infoq.com/articles/shadow-table-strategy-data-migration/
- Business-rules / decision parity — https://dbseer.com/blog/data-migration-validation-how-to-prove-accuracy-completeness-and-parity/
- Parity specs + Gherkin (legacy modernization research) — https://arxiv.org/pdf/2605.18684

**Part B — onboarding & tiering**
- Temporal dev server / single binary — https://docs.temporal.io/develop/run-a-development-server · https://temporal.io/blog/temporalite-the-foundation-of-the-new-temporal-cli-experience · https://github.com/temporalio/cli
- Supabase CLI local — https://supabase.com/docs/guides/local-development/cli/getting-started
- Rails convention over configuration — https://rubyonrails.org/ · https://devopedia.org/convention-over-configuration
- create-t3-app — https://github.com/t3-oss/create-t3-app
- Keycloak start-dev — https://www.keycloak.org/getting-started/getting-started-zip
- Backstage onboarding cost (counter-example) — https://roadie.io/blog/platform-engineering-in-2026-why-diy-is-dead/ · https://riftmap.dev/blog/backstage-alternatives/
- DBOS (Postgres durable execution) — https://dbos.dev/ · https://www.tiarebalbi.com/en/blog/dbos-vs-temporal-postgres-durable-execution
- Distributed SQLite (libSQL/Turso/LiteFS) — https://dev.to/dataformathub/distributed-sqlite-why-libsql-and-turso-are-the-new-standard-in-2026-58fk

**Part B — templates, AI kickstart, enterprise tier**
- Low-code domain templates (insurance/LOS/KYC) — https://openkoda.com/best-insurance-low-code-platforms/ · https://www.datamatics.com/resources/case-studies/demos/loan-origination-system-demo · https://newgensoft.com/resources/article/how-low-code-platforms-are-redefining-financial-services-software-development/
- Semantic scaffolding / NL→scaffold — https://medium.com/@smithmr8/the-machine-learned-our-language-6dc1f33f5286 · https://www.figma.com/resource-library/ai-app-builders/
- Feature flags for compliance / SSO — https://www.getunleash.io/blog/soc-2-how-feature-flags-can-help-achieve-compliance
- Enterprise readiness checklist — https://workos.com/blog/enterprise-readiness-checklist-2026
