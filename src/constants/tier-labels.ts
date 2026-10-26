/**
 * Tier labels: what a school calls the four tiers of its content. A customer may call a Grade a Track, a Level a
 * Module. The names are display only; they change nothing about how the tiers behave.
 *
 * They are kept in the school's `brandingconfig`:
 *  - `labelPreset`: the name of a preset below (`school` or `company`), or absent for the platform default;
 *  - `labels`: the school's own label for any of the four tiers (it replaces that tier's preset label whole);
 *  - `hideSingleItemTiers`: a client skips a tier in navigation when it holds a single item.
 *
 * Precedence, per tier: the platform default, then the school's preset, then the school's own label.
 * The platform default is the `school` preset.
 *
 * NO KHMER IS WRITTEN HERE. The presets are English only. A school's `km` text is typed by the school's own native
 * speaker and stored as it was typed; it is never produced or corrected by this code.
 */

export const TIERS = ["curriculum", "grade", "level", "lesson"] as const;
export type Tier = (typeof TIERS)[number];

/** One tier's label: English singular and plural, and the Khmer text when the school has typed one. */
export interface TierLabel {
  en: { one: string; other: string };
  km?: string;
}

export type TierLabels = Record<Tier, TierLabel>;

export const LABEL_PRESET_NAMES = ["school", "company"] as const;
export type LabelPresetName = (typeof LABEL_PRESET_NAMES)[number];

export const LABEL_PRESETS: Readonly<Record<LabelPresetName, Readonly<TierLabels>>> = {
  school: {
    curriculum: { en: { one: "Curriculum", other: "Curricula" } },
    grade: { en: { one: "Grade", other: "Grades" } },
    level: { en: { one: "Level", other: "Levels" } },
    lesson: { en: { one: "Lesson", other: "Lessons" } },
  },
  company: {
    curriculum: { en: { one: "Programme", other: "Programmes" } },
    grade: { en: { one: "Track", other: "Tracks" } },
    level: { en: { one: "Module", other: "Modules" } },
    lesson: { en: { one: "Lesson", other: "Lessons" } },
  },
};

/** The preset every school starts from. */
export const PLATFORM_DEFAULT_PRESET: LabelPresetName = "school";

/** The longest label text, in UTF-16 code units (Khmer words carry many combining marks). */
export const MAX_LABEL_LENGTH = 60;

/** The `brandingconfig` keys this feature owns. */
export const LABEL_KEYS = ["labelPreset", "labels", "hideSingleItemTiers"] as const;
