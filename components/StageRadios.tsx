// The 3-way career-stage choice, shared by the signup and profile forms. The
// parent owns the state and applies the stage's cascade on change.

import { OPTION_CARD, OPTION_INPUT } from "@/components/FormField";
import { STAGE_OPTIONS, type Stage } from "@/lib/careerStage";

export function StageRadios({
  id,
  value,
  onChange,
}: {
  /** Signup gives the group an id so its missing-fields list can focus it. */
  id?: string;
  value: Stage | null;
  onChange: (next: Stage) => void;
}) {
  return (
    <div id={id} tabIndex={id ? -1 : undefined} className="flex flex-col gap-2">
      {STAGE_OPTIONS.map((o) => (
        <label key={o.stage} className={OPTION_CARD}>
          <input
            type="radio"
            name="stage"
            className={OPTION_INPUT}
            checked={value === o.stage}
            onChange={() => onChange(o.stage)}
          />
          <span>
            {o.label}
            <span className="block text-sm text-muted">{o.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
