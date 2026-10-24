// The 3-way career-stage choice, shared by the signup and profile forms. The
// parent owns the state and applies the stage's cascade on change.

import { OPTION_CARD, OPTION_CARD_DISABLED, OPTION_INPUT, OptionDisabledReason } from "@/components/FormField";
import { STAGE_OPTIONS, type Stage } from "@/lib/careerStage";

export function StageRadios({
  id,
  value,
  onChange,
  disabled = {},
}: {
  /** Signup gives the group an id so its missing-fields list can focus it. */
  id?: string;
  value: Stage | null;
  onChange: (next: Stage) => void;
  /** Stages the other answers rule out, each with the reason shown under it.
   *  The caller never passes the picked stage, so a saved pair can be undone. */
  disabled?: Partial<Record<Stage, string>>;
}) {
  return (
    <div id={id} tabIndex={id ? -1 : undefined} className="flex flex-col gap-2">
      {STAGE_OPTIONS.map((o) => {
        const reason = disabled[o.stage];
        return (
          <label key={o.stage} className={reason ? OPTION_CARD_DISABLED : OPTION_CARD}>
            <input
              type="radio"
              name="stage"
              className={OPTION_INPUT}
              checked={value === o.stage}
              disabled={Boolean(reason)}
              onChange={() => onChange(o.stage)}
            />
            <span>
              {o.label}
              <span className="block text-sm text-muted">{o.hint}</span>
              {reason && <OptionDisabledReason reason={reason} />}
            </span>
          </label>
        );
      })}
    </div>
  );
}
