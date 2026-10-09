/**
 * The kinds of learning item (a `lessonlearnings` row) this API knows.
 *
 * Phase 0 knows only `video`: today's learning, played from its document. A payload or
 * a row naming any other type is refused, never guessed at (design note, principle 3).
 * Adding a type is a code change here, not an ALTER: the column is a string.
 */
export const LEARNING_ITEM_TYPES = ["video"] as const;
export type LearningItemType = (typeof LEARNING_ITEM_TYPES)[number];

export const DEFAULT_LEARNING_ITEM_TYPE: LearningItemType = "video";

/** The longest a type name may be (the column is STRING(16)). */
export const LEARNING_ITEM_TYPE_MAX_LENGTH = 16;

/** Per type: whether the item must name a primary `documentid`, and whether its body must be null. */
export const LEARNING_ITEM_RULES: Record<LearningItemType, { documentRequired: boolean; bodyMustBeNull: boolean }> = {
  video: { documentRequired: true, bodyMustBeNull: true },
};

/** What a link row (`lessonlearningdocuments`) may be for. Phases 1 and 2 add to this list. */
export const LEARNING_DOCUMENT_ROLES = ["rendition", "asset"] as const;
export type LearningDocumentRole = (typeof LEARNING_DOCUMENT_ROLES)[number];

/** The most a serialised item body may be, in bytes (as for `settingsconfig`). */
export const LEARNING_ITEM_BODY_MAX_BYTES = 64 * 1024;

export const isLearningItemType = (value: unknown): value is LearningItemType =>
  typeof value === "string" && (LEARNING_ITEM_TYPES as readonly string[]).includes(value);
