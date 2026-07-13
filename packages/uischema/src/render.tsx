import { renderToStaticMarkup } from "react-dom/server";
import type { JSX } from "react";
import type { RendererKind } from "./types.js";
import type { StorySpec } from "./stories.js";

/**
 * The deterministic reference **renderer set** for the UI harness (doc 07 §4/§11.2). Each renderer is
 * a pure React component that emits accessible, token-classed markup with **stable ids derived from
 * the control's data path** — never a random/generated id (doc 13 §2.e: no random ids in the output).
 * Rendered headlessly via `react-dom/server`, so the harness runs under jsdom with no browser.
 *
 * Every placed control is rendered in the four PDP-shaped states (doc 07 §11.2): `hidden` (with the
 * "why" affordance), `read-only`, `error`, and `validation-failed`. The label is always
 * programmatically associated with its field, and error text is wired via `aria-describedby` — the
 * structural a11y that axe-core (WCAG 2.2 AA) then verifies.
 */

function Field(props: { story: StorySpec }): JSX.Element {
  const { story } = props;
  const id = `ctrl-${story.dataPath}`;
  const errorId = `${id}-error`;
  const invalid = story.state === "error" || story.state === "validation-failed";
  const readOnly = story.state === "read-only";
  const describedBy = invalid ? errorId : undefined;

  const control = renderControl(story.renderer, {
    id,
    name: story.dataPath,
    value: story.value,
    enumOptions: story.enumOptions,
    readOnly,
    invalid,
    describedBy,
  });

  return (
    <div className="if-control" data-renderer={story.renderer} data-state={story.state}>
      {story.renderer === "boolean" ? (
        <div className="if-field if-field-boolean">
          {control}
          <label htmlFor={id} className="if-label">
            {story.label}
          </label>
        </div>
      ) : (
        <div className="if-field">
          <label htmlFor={id} className="if-label">
            {story.label}
          </label>
          {control}
        </div>
      )}
      {readOnly ? (
        <span className="if-readonly-note" aria-hidden="true">
          read-only
        </span>
      ) : null}
      {invalid && story.message ? (
        <p id={errorId} className="if-error" role="alert">
          {story.message}
        </p>
      ) : null}
    </div>
  );
}

interface ControlProps {
  id: string;
  name: string;
  value: string | boolean;
  enumOptions?: string[];
  readOnly: boolean;
  invalid: boolean;
  describedBy?: string;
}

function renderControl(kind: RendererKind, p: ControlProps): JSX.Element {
  const common = {
    id: p.id,
    name: p.name,
    className: "if-input",
    "aria-invalid": p.invalid ? true : undefined,
    "aria-describedby": p.describedBy,
    "aria-readonly": p.readOnly ? true : undefined,
  } as const;

  switch (kind) {
    case "number":
      return (
        <input {...common} type="number" defaultValue={String(p.value)} readOnly={p.readOnly} />
      );
    case "multiline":
      return <textarea {...common} readOnly={p.readOnly} defaultValue={String(p.value)} />;
    case "boolean":
      return (
        <input
          {...common}
          type="checkbox"
          defaultChecked={p.value === true}
          disabled={p.readOnly}
        />
      );
    case "enum":
      return (
        <select {...common} defaultValue={String(p.value)} disabled={p.readOnly}>
          {(p.enumOptions ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case "text":
    default:
      return <input {...common} type="text" defaultValue={String(p.value)} readOnly={p.readOnly} />;
  }
}

function HiddenByPolicy(props: { story: StorySpec }): JSX.Element {
  const { story } = props;
  return (
    <div className="if-control if-pdp-hidden" data-renderer={story.renderer} data-state="hidden">
      <div className="if-field">
        <span className="if-label if-hidden-label">{story.label}</span>
        <span className="if-hidden-note">Hidden by policy</span>
        <button type="button" className="if-why" aria-label={`Why is ${story.label} hidden?`}>
          Why?
        </button>
      </div>
    </div>
  );
}

/** Render one story to its serialized-DOM fragment (the committed snapshot unit). */
export function renderStoryFragment(story: StorySpec): string {
  const element =
    story.state === "hidden" ? <HiddenByPolicy story={story} /> : <Field story={story} />;
  return renderToStaticMarkup(element);
}

/** Wrap a story fragment in a minimal, landmark-complete document so page-level a11y rules apply. */
export function renderStoryDocument(story: StorySpec): string {
  const fragment = renderStoryFragment(story);
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    `<head><meta charset="utf-8"><title>${story.label} — ${story.state}</title></head>`,
    "<body><main>",
    `<h1>${story.label}</h1>`,
    "<form>",
    fragment,
    "</form>",
    "</main></body>",
    "</html>",
  ].join("");
}
