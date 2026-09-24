import {
  DEFAULT_EFFORT_LEVELS,
  EFFORT_ORDER,
  isEffortLevel,
  pickEffort,
  type EffortLevel,
} from "commons/model-rules";
import type { ModelOption } from "commons/types";

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Low effort",
  medium: "Medium effort",
  high: "High effort",
  xhigh: "Extra high effort",
  max: "Max effort",
};

const DEFAULT_SHOWN_EFFORT = "high";

// Absent levels mean the usual four, which is what the picker offered for
// every model before models reported their own (OpenCode's still do not).
function levelsFor(model: ModelOption | undefined): readonly string[] {
  if (!model?.supportsEffort) {
    return [];
  }
  return model.effortLevels ?? DEFAULT_EFFORT_LEVELS;
}

export function effortOptions(
  model: ModelOption | undefined,
): { value: EffortLevel; label: string }[] {
  return levelsFor(model)
    .filter(isEffortLevel)
    .sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b))
    .map((value) => ({ value, label: EFFORT_LABELS[value] }));
}

// The level a run will use for this model, decided by the same rule the
// backend applies, so the picker never shows a level that will not run.
export function shownEffort(
  model: ModelOption | undefined,
  saved: string | undefined,
): EffortLevel | undefined {
  return pickEffort(levelsFor(model), saved || DEFAULT_SHOWN_EFFORT);
}
