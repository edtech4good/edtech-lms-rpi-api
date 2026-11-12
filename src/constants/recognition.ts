/**
 * The per-tier recognition setting of a curriculum: what a learner receives for completing a level, a grade and the
 * whole curriculum. Central decides it and sends it in the content payload; this server stores what it receives.
 * Only `levelrecognition = 'award'` changes anything here (it is what lets a level earn an award); the other two
 * values are stored for the certificates work.
 *
 * Values are lower-case strings exactly as listed. The column defaults (the school preset's) are in the migration
 * 20261112100000-curriculum-recognition.
 */
export const RECOGNITION_FIELDS = ["levelrecognition", "graderecognition", "curriculumrecognition"] as const;
export type RecognitionField = (typeof RECOGNITION_FIELDS)[number];

export const ALLOWED_RECOGNITION: Record<RecognitionField, readonly string[]> = {
  levelrecognition: ["none", "award", "certificate"],
  graderecognition: ["none", "certificate"],
  curriculumrecognition: ["none", "certificate"],
};

/** What a curriculum row holds when its payload row carried no setting (the column defaults). */
export const DEFAULT_RECOGNITION: Record<RecognitionField, string> = {
  levelrecognition: "award",
  graderecognition: "certificate",
  curriculumrecognition: "none",
};

/** The name of the first field present on the row whose value is not allowed for its tier, else null. */
export const firstBadRecognitionField = (row: Record<string, unknown>): RecognitionField | null => {
  for (const field of RECOGNITION_FIELDS) {
    const value = row[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || !ALLOWED_RECOGNITION[field].includes(value)) return field;
  }
  return null;
};
