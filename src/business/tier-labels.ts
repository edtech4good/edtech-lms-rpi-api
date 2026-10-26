import {
  LABEL_PRESETS,
  LABEL_PRESET_NAMES,
  LabelPresetName,
  MAX_LABEL_LENGTH,
  PLATFORM_DEFAULT_PRESET,
  TIERS,
  TierLabel,
  TierLabels,
} from "src/constants/tier-labels";

/** What a school record carries beside its stored `brandingconfig`: the labels as a client shows them. */
export interface ResolvedLabels {
  labelsresolved: TierLabels;
  hideSingleItemTiers: boolean;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ownText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 && value.length <= MAX_LABEL_LENGTH ? value.trim() : undefined;

/**
 * One tier's label as stored: both English forms are required, the Khmer text is kept when it is text. Anything else
 * (a stored value from before the rules, or hand-edited) is ignored, so the tier falls back to its preset.
 */
export const ownLabelOf = (stored: unknown): TierLabel | undefined => {
  if (!isPlainObject(stored) || !isPlainObject(stored.en)) {
    return undefined;
  }
  const one = ownText(stored.en.one);
  const other = ownText(stored.en.other);
  if (one === undefined || other === undefined) {
    return undefined;
  }
  const km = ownText(stored.km);
  return km === undefined ? { en: { one, other } } : { en: { one, other }, km };
};

const copyOf = (label: TierLabel): TierLabel => (label.km === undefined ? { en: { ...label.en } } : { en: { ...label.en }, km: label.km });

/** The preset a stored `brandingconfig` names, or the platform default's name. */
export const presetNameOf = (brandingconfig: unknown): LabelPresetName => {
  const stored = isPlainObject(brandingconfig) ? brandingconfig.labelPreset : undefined;
  return (LABEL_PRESET_NAMES as readonly unknown[]).includes(stored) ? (stored as LabelPresetName) : PLATFORM_DEFAULT_PRESET;
};

/**
 * The four labels a client shows for a school, from its stored `brandingconfig` (null, or any shape): per tier, the
 * platform default, overridden by the school's preset, overridden by the school's own label. Always all four tiers.
 */
export const resolveTierLabels = (brandingconfig: unknown): ResolvedLabels => {
  const config = isPlainObject(brandingconfig) ? brandingconfig : {};
  const preset = LABEL_PRESETS[presetNameOf(config)];
  const own = isPlainObject(config.labels) ? config.labels : {};
  const labelsresolved = {} as TierLabels;
  for (const tier of TIERS) {
    labelsresolved[tier] = copyOf(ownLabelOf(own[tier]) ?? preset[tier] ?? LABEL_PRESETS[PLATFORM_DEFAULT_PRESET][tier]);
  }
  return { labelsresolved, hideSingleItemTiers: config.hideSingleItemTiers === true };
};

/** A school row (or its JSON) with the resolved labels beside it. Every field the row had is kept as it was. */
export const withResolvedLabels = <T extends { brandingconfig?: unknown }>(school: T): T & ResolvedLabels => ({
  ...school,
  ...resolveTierLabels(school.brandingconfig),
});

