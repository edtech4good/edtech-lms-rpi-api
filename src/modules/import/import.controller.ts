import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
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
import { chunk } from "lodash";
import "multer";
import { SchoolUserBusiness } from "src/business/schooluser.business";
import { StudentBusiness } from "src/business/student.business";
import { exportpayload, StudentProgressBusiness } from "src/business/studentprogress.business";
import { SyncBusiness } from "src/business/sync.business";
import { Logger } from "src/config";
import { UploadLimits } from "src/constants/upload-limits";
import { User } from "src/decorators/user.decorator";
import { ServerSyncGuard } from "src/guards/server-sync.guard";
import { LOGTYPE } from "src/models/enums/logaccess.enum";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { ResponseBoolean } from "src/models/ResponseBoolean";
import { Sync } from "src/models/Sync";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";

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
    throw new BadRequestException({
      error: true,
      errormessage: "Invalid file",
    });
  }
  try {
    return new AdmZip(file.buffer);
  } catch {
    throw new BadRequestException({
      error: true,
      errormessage: "Invalid file",
    });
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
    throw new BadRequestException({
      error: true,
      errormessage: "import too large",
    });
  }
}
@ApiTags("Import")
@Controller("import")
@ApiBearerAuth()
export class ImportController {
  // Roster imports: central's server sync key only, online and on a Pi. No
  // client sends these with a user token.
  @Put("students")
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
        newstudents = newstudents.map((x) => {
          const dob = x.dateofjoin ? parseISO(x.student.dateofjoin) : null;
          const doj = x.dateofbirth ? parseISO(x.student.dateofbirth) : null;
          return {
            ...x,
            dateofbirth: dob,
            dateofjoin: doj,
          };
        });
        const su = new SchoolUserBusiness();
        const st = new StudentBusiness();
        const stp = new StudentProgressBusiness();
        const tnx = await dbinstance.getdbinstance().transaction();
        try {
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
          tnx.commit();
        } catch(e) {
          tnx.rollback();
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
        newteachers = JSON.parse(teachersjson);
        await su.importschoolteachers(newteachers, tnx);
        tnx.commit();
      } catch {
        tnx.rollback();
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

  // Content import: the server sync key, plus staff tokens on a classroom Pi
  // only, where the Android teacher app carries central's content zip in.
  @Put("master")
  @UseGuards(
    ServerSyncGuard(SchoolRole.ADMIN, SchoolRole.SUPERADMIN, SchoolRole.TEACHER)
  )
  @ApiResponse({
    status: 200,
    description: "Complete sync successfully",
    schema: { $ref: getSchemaPath(ResponseBoolean) },
  })
  @ApiResponse({
    status: 400,
    description: "Error while sync",
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
  ): Promise<ResponseBoolean> {
    const zip = openZip(file);
    const zipEntries = zip.getEntries(); // an array of ZipEntry records
    if (zipEntries.length > 0) {
      assertEntryWithinLimit(zipEntries[0], UploadLimits.MASTER_ZIP_DECOMPRESSED_MAX_BYTES);
      const tnx = await dbinstance.getdbinstance().transaction();
      try {
        const data = zipEntries[0].getData().toString("utf8");
        let newsync: Sync = new Sync();
        newsync = JSON.parse(data);
        const syncb = new SyncBusiness(tnx);

        // Sync is a full-replace of content by id: cleanup() wipes every
        // content table (including ones students hold FKs into, e.g.
        // grades/levels/lessons) and the imports below re-create the SAME
        // primary keys from the same central payload. Content ids are
        // stable across syncs (central is the id authority), so once the
        // import completes the student FK values are valid again. Turning
        // FOREIGN_KEY_CHECKS off/on is what makes the intermediate
        // (post-cleanup, pre-import) state tolerable instead of failing
        // cleanup() with ER_ROW_IS_REFERENCED on any Pi where students
        // have progress. This is a session variable scoped to this pooled
        // connection only (SET, not SET GLOBAL) — it MUST be restored to
        // 1 before the transaction ends on every path (commit or
        // rollback), or the connection goes back into the pool with
        // checks permanently off for whichever request borrows it next.
        await dbinstance
          .getdbinstance()
          .query("SET FOREIGN_KEY_CHECKS = 0", { transaction: tnx });
        try {
          await syncb.cleanup();
          const tempdocumentschunk = chunk(newsync.documents, 2000);

          for await (const smallchunk of tempdocumentschunk) {
            await syncb.documents(smallchunk);
          }
          //to ensure unbroken connection
          const tempquestionschunk = chunk(newsync.questions, 2000);
          for await (const smallchunk of tempquestionschunk) {
            await syncb.questions(smallchunk);
          }

          await syncb.curriculum(newsync.curriculums);
          await syncb.curriculumbaseline(newsync.curriculumbaselines);
          await syncb.grade(newsync.grades);
          await syncb.level(newsync.levels);
          await syncb.lesson(newsync.lessons);
          // countries -> schools -> standards: standards.schoolid references
          // schools, and schools.countryid references countries, so both
          // must be imported before standards. (Belt-and-braces alongside
          // FOREIGN_KEY_CHECKS=0 above: correct on its own merits if that
          // scope is ever narrowed.)
          await syncb.countries(newsync.countries);
          await syncb.schools(newsync.schools);
          await syncb.standards(newsync.standards);

          const tempquestionschunk1 = chunk(newsync.lessonlearnings, 1);
          for await (const smallchunk of tempquestionschunk1) {
            await syncb.lessonlearnings(smallchunk);
          }

          //await syncb.lessonlearnings(newsync.lessonlearnings);
          await syncb.lessonquizzes(newsync.lessonquizzes);
          await syncb.lessonpractices(newsync.lessonpractices);
          await syncb.lessonpracticequestions(newsync.lessonpracticequestions);
          await syncb.lessonquizquestions(newsync.lessonquizquestions);
          await syncb.levelquizquestions(newsync.levelquizquestions);
          await syncb.baselinequestion(newsync.baselinequestion);
          await syncb.lessonplans(newsync.lessonplans);
          await syncb.subject(newsync.subjects);
        } finally {
          await dbinstance
            .getdbinstance()
            .query("SET FOREIGN_KEY_CHECKS = 1", { transaction: tnx });
        }

        tnx.commit();
        Logger.info(`<${user.schoolusername}> import contents`, {logaccesstype: LOGTYPE.IMPORTCONTENTS, userid: user.schooluserid});
        return {
          error: false,
          data: true,
        };
      } catch (e: any) {
        Logger.info(e);
        tnx.rollback();
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
