/**
 * Multer upload caps (edtech-lms-rpi-api#23). Values are byte counts.
 *
 * ROSTER_ZIP_DECOMPRESSED_MAX_BYTES and MASTER_ZIP_DECOMPRESSED_MAX_BYTES
 * additionally cap the *uncompressed* size of the single entry read out of
 * an import zip, so a small file that decompresses to something huge (a
 * zip bomb) is rejected before it is expanded into memory.
 *
 * Roster payloads (students/teachers) are a JSON export of one school's
 * users and get their own, much smaller decompressed cap than master
 * (which carries curriculum content and media): a roster upload is already
 * capped at 20 MB compressed, so anything claiming to unpack past 50 MB is
 * either not a real roster or is lying about its size, and either way isn't
 * worth inflating to find out.
 */
export const UploadLimits = {
  STUDENTS_IMPORT_MAX_BYTES: 20 * 1024 * 1024,
  TEACHERS_IMPORT_MAX_BYTES: 20 * 1024 * 1024,
  MASTER_IMPORT_MAX_BYTES: 200 * 1024 * 1024,
  ROSTER_ZIP_DECOMPRESSED_MAX_BYTES: 50 * 1024 * 1024,
  MASTER_ZIP_DECOMPRESSED_MAX_BYTES: 500 * 1024 * 1024,
} as const;
