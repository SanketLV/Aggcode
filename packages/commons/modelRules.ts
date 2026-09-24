// The backend decides which model and effort a run uses, and the UI decides
// which ones it shows. Both go through these functions so they cannot
// disagree about a session.

// Ordered weakest to strongest; the order is what "nearest level" means.
export const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"] as const;

export type EffortLevel = (typeof EFFORT_ORDER)[number];

// What a model that supports effort but does not say which levels gets: the
// four that were verified with real runs before the SDK reported levels.
export const DEFAULT_EFFORT_LEVELS: readonly EffortLevel[] = [
  "low",
  "medium",
  "high",
  "max",
];

export function isEffortLevel(value: unknown): value is EffortLevel {
  return (
    typeof value === "string" &&
    (EFFORT_ORDER as readonly string[]).includes(value)
  );
}

// A level the model does not list is never sent, and the SDK accepts no
// effort at all for a model without effort support, so an unsupported request
// moves to the nearest supported level (the lower one on a tie).
export function pickEffort(
  levels: readonly string[] | undefined,
  requested: string | undefined,
): EffortLevel | undefined {
  if (!isEffortLevel(requested)) {
    return undefined;
  }

  const supported = (levels ?? [])
    .filter(isEffortLevel)
    .sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b));
  if (supported.length === 0) {
    return undefined;
  }

  const target = EFFORT_ORDER.indexOf(requested);
  let best = supported[0];
  let bestDistance = Infinity;
  for (const level of supported) {
    const distance = Math.abs(EFFORT_ORDER.indexOf(level) - target);
    // Ascending order plus a strict comparison keeps the lower level on a tie.
    if (distance < bestDistance) {
      best = level;
      bestDistance = distance;
    }
  }
  return best;
}

const DATE_SUFFIX = /-\d{8}$/;

// Snapshot ids carry a date (claude-haiku-4-5-20251001) while the ids saved by
// older sessions may not (claude-haiku-4-5). They name the same model, so a
// match ignores the date on either side. An exact match always wins.
export function findModel<T extends { id: string }>(
  models: readonly T[],
  saved: string | undefined,
): T | undefined {
  if (!saved) {
    return undefined;
  }
  const exact = models.find((m) => m.id === saved);
  if (exact) {
    return exact;
  }
  const family = saved.replace(DATE_SUFFIX, "");
  return models.find((m) => m.id.replace(DATE_SUFFIX, "") === family);
}
