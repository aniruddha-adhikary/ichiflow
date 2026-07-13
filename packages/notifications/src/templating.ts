import type { NotificationRequest, NotificationTemplate, RenderedMessage } from "./types.js";

/** A render failure (missing locale / undeclared or missing param / unresolved placeholder). Surfaced, never silently emitted. */
export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Collect every `{{param}}` referenced in a text fragment. */
function placeholdersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER)) found.add(match[1]!);
  return found;
}

/**
 * Substitute the request's declared params into a text fragment (doc 05 §4.2). Pure: every `{{param}}`
 * must be a declared template param with a supplied value, or it is a `RenderError` — no partial or
 * silently-dropped placeholder ever reaches a provider, so the goldens stay total.
 */
function substitute(text: string, params: Record<string, string>, declared: Set<string>): string {
  for (const ref of placeholdersIn(text)) {
    if (!declared.has(ref)) {
      throw new RenderError(`placeholder {{${ref}}} is not a declared template param`);
    }
    if (!(ref in params)) {
      throw new RenderError(`request supplies no value for declared param {{${ref}}}`);
    }
  }
  return text.replace(PLACEHOLDER, (_whole, ref: string) => params[ref]!);
}

/**
 * Render a `NotificationRequest` against its template to the exact `RenderedMessage` a provider driver
 * delivers (build plan 5.4, doc 05 §4.2). A **pure** function of (template, request): the request's
 * `locale` must resolve to an entry in the template's per-locale `text` map, and every supplied param
 * must be one the template declares. Deterministic — no wall clock, no RNG — so its goldens are stable.
 */
export function render(
  template: NotificationTemplate,
  request: NotificationRequest,
): RenderedMessage {
  const text = template.text[request.locale];
  if (!text) {
    throw new RenderError(
      `template ${template.id}@${template.version} has no text for locale ${request.locale}`,
    );
  }
  for (const supplied of Object.keys(request.params)) {
    if (!template.params.includes(supplied)) {
      throw new RenderError(`request supplies undeclared param ${supplied}`);
    }
  }
  const declared = new Set(template.params);
  const message: RenderedMessage = {
    channel: template.channel,
    locale: request.locale,
    recipient: request.recipient,
    body: substitute(text.body, request.params, declared),
  };
  // Subject applies to email only; SMS templates carry body-only text.
  if (template.channel === "email" && text.subject !== undefined) {
    message.subject = substitute(text.subject, request.params, declared);
  }
  return message;
}
