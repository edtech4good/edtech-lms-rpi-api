import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { OrgPolicy } from "src/decorators/orgPolicy.decorator";
import { FileInterceptor } from "@nestjs/platform-express/multer";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from "@nestjs/swagger";
import AdmZip from "adm-zip";
import { parseISO } from "date-fns";
import "multer";
import { Transaction } from "sequelize";
import { OwnershipBusiness, OwnershipResult } from "src/business/ownership.business";
import { SchoolUserBusiness } from "src/business/schooluser.business";
import { StudentBusiness } from "src/business/student.business";
import { exportpayload, StudentProgressBusiness } from "src/business/studentprogress.business";
import { OrganisationContent } from "./organisation-content.validator";
import { OrganisationContentImport, OrganisationContentResult } from "src/business/organisation-content.business";
import { assertRosterBelongsToSchool, RosterSchoolError, withRequiredSchoolIds } from "src/business/school-identity";
import { Logger } from "src/config";
import { UploadLimits } from "src/constants/upload-limits";
import { User } from "src/decorators/user.decorator";
import { ApiError } from "src/models/ApiError";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { SERVER_SYNC_USER_ID, ServerSyncGuard } from "src/guards/server-sync.guard";
import { LOGTYPE } from "src/models/enums/logaccess.enum";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { ResponseBoolean } from "src/models/ResponseBoolean";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";
import { looksLikeOrganisationContent, validateOrganisationContent } from "./organisation-content.validator";
import { validateOwnershipBody } from "./ownership.request.validator";

/**
 * `new AdmZip(file.buffer)` throws synchronously on a malformed archive, and
 * `file` itself is undefined when the multipart part is missing entirely —
 * neither is caught by the handlers' own try/blocks, so both previously
 * escaped as a raw 500 leaking adm-zip internals in the message. Centralized
 * here so all three import routes fail the same way as their other
 * validation errors: a 400 "Invalid file".
 */
function openZip(file: Express.Multer.File): AdmZip {
  if (!file || !file.buffer) {
    throw new ApiError(ErrorCode.FILE_REJECTED, { message: "Invalid file." });
  }
  try {
    return new AdmZip(file.buffer);
  } catch {
    throw new ApiError(ErrorCode.FILE_REJECTED, { message: "Invalid file." });
  }
}

/**
 * Rejects an entry whose *claimed* uncompressed size exceeds `maxBytes`,
 * before anything calls `getData()` on it. `entry.header.size` comes from
 * the zip's central directory and is attacker-controlled — a small file can
 * claim a huge size (a zip bomb) — but it's read for free, so checking it
 * first avoids inflating the entry into memory just to find out.
 */
function assertEntryWithinLimit(entry: AdmZip.IZipEntry, maxBytes: number): void {
  if (entry.header.size > maxBytes) {
    throw new ApiError(ErrorCode.FILE_REJECTED, {
      message: "import too large",
      status: HttpStatus.PAYLOAD_TOO_LARGE,
    });
  }
}

/**
 * Rolls back an import transaction without letting a second failure mask the
 * first. If `commit()` itself rejected, Sequelize has already marked the
 * transaction finished and `rollback()` throws "has been finished with state:
 * commit" — which would replace the handler's 400 with a raw 500.
 */
async function rollbackQuietly(tnx: Transaction): Promise<void> {
  try {
    await tnx.rollback();
  } catch (e) {
    Logger.error("import rollback failed", { error: e });
  }
}

const CLAIM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who may import ONE organisation's content (format 3):
 *  - central, with the server sync key: always;
 *  - a staff token (a classroom Pi only; the guard admits no other user token) whose
 *    `organisationid` claim is that organisation: allowed (checked before the payload is
 *    read, so another organisation's teacher learns nothing of it);
 *  - anything else (another organisation's claim, a claim that is not an organisation id,
 *    an empty string included, no claim at all): 403, on a Pi as much as online.
 */
function assertMayImportOrganisation(user: Token | undefined, organisationid: unknown): void {
  if (user?.schooluserid === SERVER_SYNC_USER_ID) {
    return;
  }
  const claim = user?.organisationid;
  if (
    typeof claim === "string" &&
    CLAIM_ID.test(claim) &&
    typeof organisationid === "string" &&
    claim.toLowerCase() === organisationid.toLowerCase()
  ) {
    return;
  }
  throw new ApiError(ErrorCode.NOT_ALLOWED);
}

/** What a payload that is not one organisation's content (format 3) is told. */
const FORMAT_RETIRED_MESSAGE =
  "This server accepts one organisation's content (format 3). Export it from the admin and send it again.";

@ApiTags("Import")
@Controller("import")
@ApiBearerAuth()
export class ImportController {
  // Roster imports: central's server sync key only, online and on a Pi. No
  // client sends these with a user token.
  @Put("students")
  @OrgPolicy("server", { note: "Roster for one school; refuses rows of any other school (5c).", enforcedBy: "src/modules/import/import.roster.school.spec.ts" })
  @UseGuards(ServerSyncGuard())
  @ApiResponse({
    status: 200,
    description: "students imported successfully",
    schema: { $ref: getSchemaPath(ResponseBoolean) },
  })
  @ApiResponse({
    status: 400,
    description: "Error while importing students",
  })
  @ApiResponse({
    status: 413,
    description: "File too large",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        importfile: {
          type: "string",
          format: "binary",
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor("importfile", {
      limits: { fileSize: UploadLimits.STUDENTS_IMPORT_MAX_BYTES },
    })
  )
  @HttpCode(HttpStatus.OK)
  @ApiConsumes("multipart/form-data")
  async studentsimport(
    @UploadedFile() file: Express.Multer.File,
    @User() user: Token
  ): Promise<ResponseBoolean> {
    const zip = openZip(file);
    const zipEntries = zip.getEntries(); // an array of ZipEntry records
    if (zipEntries.length > 0) {
      assertEntryWithinLimit(zipEntries[0], UploadLimits.ROSTER_ZIP_DECOMPRESSED_MAX_BYTES);
      try {
        const studentsjson = zipEntries[0].getData().toString("utf8");
        let newstudents: Array<any> = [];
        const payload: exportpayload = JSON.parse(studentsjson);
        newstudents = payload.studentusers;
        const studentprogresses = payload.studentprogresses;
        // Central sends each schooluser with its `students` row nested under
        // `student`, dates as ISO strings. The dates live on that nested row
        // and it is the one written to `students` below, so parse them there.
        // (This used to read the top-level fields, which central never sends,
        // swap birth and join, and put the result on the schooluser row, where
        // it was dropped — so the parse never reached the `students` write.)
        newstudents = newstudents.map((x) => ({
          ...x,
          student: x.student && {
            ...x.student,
            dateofbirth: x.student.dateofbirth ? parseISO(x.student.dateofbirth) : null,
            dateofjoin: x.student.dateofjoin ? parseISO(x.student.dateofjoin) : null,
          },
        }));
        const su = new SchoolUserBusiness();
        const st = new StudentBusiness();
        const stp = new StudentProgressBusiness();
        const tnx = await dbinstance.getdbinstance().transaction();
        try {
          // A roster that names its school (format 3) may only carry that school's rows.
          if (payload.schoolid !== undefined) {
            await assertRosterBelongsToSchool(
              newstudents.map((x) => [x, x.student]),
              payload.schoolid,
              tnx
            );
          }
          // Every login and every learner row must name a school this server has: refused here, before the
          // first write (the writers below ask again).
          await withRequiredSchoolIds(newstudents, tnx);
          await withRequiredSchoolIds(newstudents.map((x) => x.student ?? {}), tnx);
          const suresult = await su.importschoolusers(newstudents, tnx);
          await st.importstudents(
            suresult.map((x: any) => {
              const tempstudent = newstudents.find(
                (y) => y.schoolusername === x.schoolusername
              );

              return {
                ...tempstudent.student,
                schooluserid: tempstudent.schooluserid,
              };
            }),
            tnx
          );
          if(studentprogresses){
            await stp.importStudentProgress(studentprogresses.studentprogress, tnx);
            await stp.importStudentLearningProgress(studentprogresses.studentlearningprogress, tnx);
            await stp.importStudentGradesProgress(studentprogresses.studentgradesprogress, tnx);
            await stp.importStudentLevelsProgress(studentprogresses.studentlevelsprogress, tnx);
            await stp.importStudentLessonsProgress(studentprogresses.studentlessonsprogress, tnx);
          }
          await tnx.commit();
        } catch(e) {
          await rollbackQuietly(tnx);
          if (e instanceof RosterSchoolError) {
            throw e;
          }
          throw new BadRequestException({
            error: true,
            errormessage: "Invalid file",
          });
        }
        Logger.info(`<${user.schoolusername}> import students`, {logaccesstype: LOGTYPE.IMPORTSTUDENT, userid: user.schooluserid});
        return {
          error: false,
          data: true,
        };
      } catch (e) {
        if (e instanceof RosterSchoolError) {
          throw e;
        }
        throw new BadRequestException({
          error: true,
          errormessage: "Invalid file",
        });
      }
    } else {
      throw new BadRequestException({
        error: true,
        errormessage: "Invalid file",
      });
    }
  }

  @Put("teachers")
  @OrgPolicy("server", { note: "Roster for one school; refuses rows of any other school (5c).", enforcedBy: "src/modules/import/import.roster.school.spec.ts" })
  @UseGuards(ServerSyncGuard())
  @ApiResponse({
    status: 200,
    description: "teachers imported successfully",
    schema: { $ref: getSchemaPath(ResponseBoolean) },
  })
  @ApiResponse({
    status: 400,
    description: "Error while importing teachers",
  })
  @ApiResponse({
    status: 413,
    description: "File too large",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        importfile: {
          type: "string",
          format: "binary",
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor("importfile", {
      limits: { fileSize: UploadLimits.TEACHERS_IMPORT_MAX_BYTES },
    })
  )
  @HttpCode(HttpStatus.OK)
  @ApiConsumes("multipart/form-data")
  async teachersimport(
    @UploadedFile() file: Express.Multer.File,
    @User() user: Token
  ): Promise<ResponseBoolean> {
    const zip = openZip(file);
    const zipEntries = zip.getEntries(); // an array of ZipEntry records
    if (zipEntries.length > 0) {
      assertEntryWithinLimit(zipEntries[0], UploadLimits.ROSTER_ZIP_DECOMPRESSED_MAX_BYTES);
      const tnx = await dbinstance.getdbinstance().transaction();
      const su = new SchoolUserBusiness();
      try {
        const teachersjson = zipEntries[0].getData().toString("utf8");
        let newteachers: Array<any> = [];
        const parsed = JSON.parse(teachersjson);
        if (Array.isArray(parsed)) {
          newteachers = parsed;
        } else {
          // A roster that names its school (format 3): `{ schoolid, teachers: [...] }`.
          if (!Array.isArray(parsed?.teachers) || parsed.schoolid === undefined) {
            throw new Error("not a teacher roster");
          }
          newteachers = parsed.teachers;
          await assertRosterBelongsToSchool(newteachers, parsed.schoolid, tnx);
        }
        // Refused before the first write: every teacher must name a school this server has.
        await withRequiredSchoolIds(newteachers, tnx);
        await su.importschoolteachers(newteachers, tnx);
        await tnx.commit();
      } catch (e) {
        await rollbackQuietly(tnx);
        if (e instanceof RosterSchoolError) {
          throw e;
        }
        throw new BadRequestException({
          error: true,
          errormessage: "Invalid file",
        });
      }
      Logger.info(`<${user.schoolusername}> import teacher`, {logaccesstype: LOGTYPE.IMPORTTEACHER, userid: user.schooluserid});
      return {
        error: false,
        data: true,
      };
    } else {
      throw new BadRequestException({
        error: true,
        errormessage: "Invalid file",
      });
    }
  }

  // Ownership import: which organisation owns each school and each piece of
  // content. Central's server sync key only, online and on a Pi: no user token
  // of any role, because it assigns ownership. It writes `organisationid` and
  // the `organisations` rows and nothing else (no deletes, no logins).
  @Put("ownership")
  @OrgPolicy("server", { note: "Central's ownership push.", enforcedBy: "src/modules/import/import.ownership.spec.ts" })
  @UseGuards(ServerSyncGuard())
  @ApiResponse({
    status: 200,
    description: "ownership applied; the body lists what was applied, refused and not found",
  })
  @ApiResponse({
    status: 400,
    description: "The body is not a format-3 ownership payload",
  })
  @ApiResponse({
    status: 503,
    description: "The database has not been migrated for organisations",
  })
  @HttpCode(HttpStatus.OK)
  async ownership(@Body() body: unknown): Promise<OwnershipResult> {
    return new OwnershipBusiness().apply(validateOwnershipBody(body));
  }

  // Content import: ONE organisation's content (format 3) only; format 2 is retired.
  // The server sync key, plus staff tokens on a classroom Pi only, where the Android
  // teacher app carries central's content zip in.
  @Put("master")
  @OrgPolicy("pi-import", {
    note: "Payload header names the organisation; on a Pi it must match the token's claim, and a token with no claim is refused (the payload's rows are proved in src/modules/import).",
    enforcedBy: "src/modules/org-boundary.leak.spec.ts",
  })
  @UseGuards(
    ServerSyncGuard(SchoolRole.ADMIN, SchoolRole.SUPERADMIN, SchoolRole.TEACHER)
  )
  @ApiResponse({
    status: 200,
    description: "One organisation's content imported; the body names the organisation and counts what was written, deleted and marked deleted per table",
    schema: {
      type: "object",
      properties: {
        error: { type: "boolean", example: false },
        data: { type: "boolean", example: true },
        organisationid: { type: "string" },
        counts: { type: "object", additionalProperties: { type: "object" } },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Not one organisation's content (format 3: format 2 is retired), or an invalid file",
  })
  @ApiResponse({
    status: 413,
    description: "File too large",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        importfile: {
          type: "string",
          format: "binary",
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor("importfile", {
      limits: { fileSize: UploadLimits.MASTER_IMPORT_MAX_BYTES },
    })
  )
  @HttpCode(HttpStatus.OK)
  @ApiConsumes("multipart/form-data")
  async completesync(
    @UploadedFile() file: Express.Multer.File,
    @User() user: Token
  ): Promise<OrganisationContentResult> {
    const zip = openZip(file);
    const zipEntries = zip.getEntries(); // an array of ZipEntry records
    if (zipEntries.length > 0) {
      assertEntryWithinLimit(zipEntries[0], UploadLimits.MASTER_ZIP_DECOMPRESSED_MAX_BYTES);
      let parsed: unknown;
      try {
        parsed = JSON.parse(zipEntries[0].getData().toString("utf8"));
      } catch {
        throw new BadRequestException({
          error: true,
          errormessage: "Invalid file",
        });
      }
      // Format 2 (the whole-content payload that replaced every table, with no owners) is retired:
      // anything that is not one organisation's content is refused before anything is read or written.
      if (!looksLikeOrganisationContent(parsed)) {
        throw new ApiError(ErrorCode.FILE_REJECTED, { message: FORMAT_RETIRED_MESSAGE });
      }
      // One organisation's content (format 3): a scoped replace, and a refusal says why.
      let content: OrganisationContent;
      try {
        assertMayImportOrganisation(user, (parsed as { organisationid?: unknown }).organisationid);
        content = validateOrganisationContent(parsed);
      } catch (e) {
        if (e instanceof ApiError) {
          throw e;
        }
        throw new BadRequestException({
          error: true,
          errormessage: "Invalid file",
        });
      }
      const tnx = await dbinstance.getdbinstance().transaction();
      try {
        const counts = await new OrganisationContentImport(tnx).run(content);
        await tnx.commit();
        Logger.info(`<${user.schoolusername}> import contents`, {logaccesstype: LOGTYPE.IMPORTCONTENTS, userid: user.schooluserid});
        return {
          error: false,
          data: true,
          organisationid: content.organisationid,
          counts,
        };
      } catch (e: any) {
        Logger.info(e);
        await rollbackQuietly(tnx);
        if (e instanceof ApiError) {
          throw e;
        }
        throw new BadRequestException({
          error: true,
          errormessage: "Invalid file",
        });
      }
    } else {
      throw new BadRequestException({
        error: true,
        errormessage: "Invalid file",
      });
    }
  }
}
