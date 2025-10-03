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
import { User } from "src/decorators/user.decorator";
import { AccessGuard } from "src/guards/access.guard";
import { TokenType } from "src/models/enums";
import { LOGTYPE } from "src/models/enums/logaccess.enum";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { ResponseBoolean } from "src/models/ResponseBoolean";
import { Sync } from "src/models/Sync";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";
@ApiTags("Import")
@Controller("import")
@ApiBearerAuth()
@UseGuards(
  AccessGuard(
    TokenType.ACCESS,
    SchoolRole.ADMIN,
    SchoolRole.SUPERADMIN,
    SchoolRole.TEACHER
  )
)
export class ImportController {
  @Put("students")
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
  @UseInterceptors(FileInterceptor("importfile"))
  @HttpCode(HttpStatus.OK)
  @ApiConsumes("multipart/form-data")
  async studentsimport(
    @UploadedFile() file: Express.Multer.File,
    @User() user: Token
  ): Promise<ResponseBoolean> {
    const zip = new AdmZip(file.buffer);
    const zipEntries = zip.getEntries(); // an array of ZipEntry records
    if (zipEntries.length > 0) {
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
  @UseInterceptors(FileInterceptor("importfile"))
  @HttpCode(HttpStatus.OK)
  @ApiConsumes("multipart/form-data")
  async teachersimport(
    @UploadedFile() file: Express.Multer.File,
    @User() user: Token
  ): Promise<ResponseBoolean> {
    const zip = new AdmZip(file.buffer);
    const zipEntries = zip.getEntries(); // an array of ZipEntry records
    if (zipEntries.length > 0) {
      const tnx = await dbinstance.getdbinstance().transaction();
      const teachersjson = zipEntries[0].getData().toString("utf8");

      let newteachers: Array<any> = [];
      newteachers = JSON.parse(teachersjson);
      const su = new SchoolUserBusiness();
      try {
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

  @Put("master")
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
  @UseInterceptors(FileInterceptor("importfile"))
  @HttpCode(HttpStatus.OK)
  @ApiConsumes("multipart/form-data")
  async completesync(
    @UploadedFile() file: Express.Multer.File,
    @User() user: Token
  ): Promise<ResponseBoolean> {
    const zip = new AdmZip(file.buffer);
    const zipEntries = zip.getEntries(); // an array of ZipEntry records
    if (zipEntries.length > 0) {
      const tnx = await dbinstance.getdbinstance().transaction();
      try {
        const data = zipEntries[0].getData().toString("utf8");
        let newsync: Sync = new Sync();
        newsync = JSON.parse(data);
        const syncb = new SyncBusiness(tnx);
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
        await syncb.standards(newsync.standards);
        await syncb.countries(newsync.countries);
        await syncb.schools(newsync.schools);

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
