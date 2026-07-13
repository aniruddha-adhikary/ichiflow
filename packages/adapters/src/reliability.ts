import type { InboundMessage, ReliabilityVector } from "./types.js";

/**
 * The **reliability** runtime (doc 05 §reliability) — at-least-once delivery *emulated* with an
 * **Idempotent Receiver** and a **Dead Letter Channel**, driven deterministically (no wall clock, no
 * RNG). This is the machinery a live binding wraps around a real transport; the harness exercises it in
 * isolation so the contract holds without a live external system (doc 13 §2.d).
 *
 *   - **Idempotent Receiver.** A stable `messageId` is checked against a dedup store *inside the same
 *     step* that would mutate business state; a duplicate is deduped once (applied to state exactly
 *     once), never twice.
 *   - **Bounded retries → DLQ.** A poison message that keeps failing is retried up to `maxAttempts`
 *     (exponential backoff is emulated as attempt counting), then quarantined in the DLQ — never
 *     dropped and never retried forever.
 *   - **Redelivery applies once.** A crash-redelivered message with a seen `messageId` is deduped, so
 *     replay does not double-apply.
 */

export interface ReliabilityOutcome {
  applied: number;
  deduped: number;
  dlq: number;
  /** Ordered per-message dispositions — useful for golden-style inspection. */
  dispositions: Array<{
    messageId: string;
    disposition: "applied" | "deduped" | "dlq";
    attempts: number;
  }>;
}

export interface Receiver {
  /** Deterministic handler: return true to apply, false to fail this attempt (a poison message keeps failing). */
  handle: (msg: InboundMessage, attempt: number) => boolean;
}

/**
 * Drive an inbound message sequence through the Idempotent Receiver + bounded-retry DLQ machinery.
 * Deterministic: the same sequence + the same handler always produce the same outcome.
 */
export function runReliability(
  messages: InboundMessage[],
  maxAttempts: number,
  receiver: Receiver,
): ReliabilityOutcome {
  const seen = new Set<string>();
  const outcome: ReliabilityOutcome = { applied: 0, deduped: 0, dlq: 0, dispositions: [] };

  for (const msg of messages) {
    if (seen.has(msg.messageId)) {
      outcome.deduped += 1;
      outcome.dispositions.push({ messageId: msg.messageId, disposition: "deduped", attempts: 0 });
      continue;
    }

    let applied = false;
    let attempts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      if (receiver.handle(msg, attempt)) {
        applied = true;
        break;
      }
    }

    if (applied) {
      // Idempotency key recorded in the same step that mutated state — subsequent copies dedup.
      seen.add(msg.messageId);
      outcome.applied += 1;
      outcome.dispositions.push({ messageId: msg.messageId, disposition: "applied", attempts });
    } else {
      // Attempts exhausted: quarantine, do not mark seen (a corrected resend is a new correlated message).
      outcome.dlq += 1;
      outcome.dispositions.push({ messageId: msg.messageId, disposition: "dlq", attempts });
    }
  }

  return outcome;
}

/**
 * The canonical receiver for the reliability vectors: a message handling deterministically **fails on
 * every attempt** iff it is flagged `poison`; otherwise it applies on the first attempt.
 */
export function poisonAwareReceiver(): Receiver {
  return { handle: (msg) => msg.poison !== true };
}

/** Run one reliability vector and report whether the pinned outcome held. */
export function evaluateVector(vector: ReliabilityVector): {
  name: string;
  scenario: string;
  expected: ReliabilityVector["expect"];
  actual: { applied: number; deduped: number; dlq: number };
  pass: boolean;
} {
  const outcome = runReliability(vector.messages, vector.maxAttempts, poisonAwareReceiver());
  const actual = { applied: outcome.applied, deduped: outcome.deduped, dlq: outcome.dlq };
  const pass =
    actual.applied === vector.expect.applied &&
    actual.deduped === vector.expect.deduped &&
    actual.dlq === vector.expect.dlq;
  return { name: vector.name, scenario: vector.scenario, expected: vector.expect, actual, pass };
}
