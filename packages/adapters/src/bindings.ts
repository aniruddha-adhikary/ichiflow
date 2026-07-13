import type { AdapterProtocol } from "./types.js";

/**
 * Transport **bindings** (doc 05 §11.2). A binding is the runtime that speaks a wire protocol; it
 * **decodes** a transport-specific frame into the plain wire message the (protocol-agnostic)
 * Message-Translator consumes. v1 ships REST + one message broker + webhook, each driven against a
 * **mock** (no live MQ/Kafka/HTTP) — the point of the canonical boundary is that all three re-home onto
 * the same mapping. SFTP is design-only/post-v1 (ADR-0028).
 *
 * The decode step is deliberately thin and pure so the harness proves the boundary without a live
 * external system: a REST frame carries a JSON `body`; a broker frame carries a `body` plus transport
 * `headers`; a webhook frame carries a `body` and `query`. Each yields the same decoded record shape.
 */

export interface RestFrame {
  protocol: "rest";
  body: Record<string, unknown>;
}

export interface BrokerFrame {
  protocol: "broker";
  headers?: Record<string, string>;
  body: Record<string, unknown>;
}

export interface WebhookFrame {
  protocol: "webhook";
  query?: Record<string, string>;
  body: Record<string, unknown>;
}

export type TransportFrame = RestFrame | BrokerFrame | WebhookFrame;

export class BindingError extends Error {}

/**
 * Decode a transport frame into the plain wire message the Message-Translator maps. Headers/query are
 * merged under stable envelope keys (`_headers` / `_query`) so a mapping may pull a correlation id from
 * a transport header via a JSON Pointer without the translator knowing the transport.
 */
export function decode(frame: TransportFrame): Record<string, unknown> {
  if (frame.body === null || typeof frame.body !== "object" || Array.isArray(frame.body)) {
    throw new BindingError(`${frame.protocol} frame body must be a JSON object`);
  }
  switch (frame.protocol) {
    case "rest":
      return { ...frame.body };
    case "broker":
      return { ...frame.body, _headers: frame.headers ?? {} };
    case "webhook":
      return { ...frame.body, _query: frame.query ?? {} };
    default: {
      const exhaustive: never = frame;
      throw new BindingError(`unknown transport frame: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** The set of transport profiles with a v1 binding (doc 05 §11.2). SFTP is intentionally absent (post-v1). */
export const V1_BINDINGS: readonly AdapterProtocol[] = ["rest", "broker", "webhook"] as const;
