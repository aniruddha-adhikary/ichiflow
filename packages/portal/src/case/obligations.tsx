import type { JSX } from "react";
import type { Obligation } from "../types.js";

/** The Case **obligation checklist** (doc 07 §7.1) — the conditions/obligations and their state. */
export interface ObligationChecklistProps {
  obligations: Obligation[];
}

export function ObligationChecklist(props: ObligationChecklistProps): JSX.Element {
  const { obligations } = props;
  return (
    <section data-testid="obligation-checklist">
      <h3>Obligations</h3>
      <ul data-testid="obligation-rows">
        {obligations.map((o) => (
          <li
            key={o.code}
            data-testid={`obligation-${o.code}`}
            data-obligation-code={o.code}
            data-obligation-state={o.state}
            data-obligation-kind={o.kind}
          >
            <input type="checkbox" readOnly checked={o.state === "fulfilled"} />
            {o.code} — {o.kind} — {o.state}
          </li>
        ))}
      </ul>
    </section>
  );
}
