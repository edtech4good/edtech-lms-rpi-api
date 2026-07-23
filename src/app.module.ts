import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { PassportModule } from "@nestjs/passport";
import { ScheduleModule } from "@nestjs/schedule";
import { MorganInterceptor, MorganModule } from "nest-morgan";
import { AppController } from "./app.controller";
import { Config } from "./config";
import { AccessModule } from "./modules/access/access.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CurriculumModule } from "./modules/curriculum/curriculum.module";
import { ExportModule } from "./modules/export/export.module";
import { GradeModule } from "./modules/grade/grade.module";
import { ImportModule } from "./modules/import/import.module";
import { LessonModule } from "./modules/lesson/lesson.module";
import { LevelModule } from "./modules/level/level.module";
import { QuestionModule } from "./modules/question/question.module";
import { ReportModule } from "./modules/report/report.module";
import { ResultModule } from "./modules/result/result.module";
import { SchoolModule } from "./modules/school/school.module";
import { StudentModule } from "./modules/student/student.module";
import { TeacherModule } from "./modules/teachers/teacher.module";
import { JwtAccessStrategy } from "./services/auth.strategy";
import { TasksService } from "./services/task.service";

const providers = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const temp: Array<any> = [PassportModule, JwtAccessStrategy];
  if (Config.fortyk.api.rpi.debug === true) {
    temp.push({
      provide: APP_INTERCEPTOR,
      useClass: MorganInterceptor("combined"),
    });
  }

  return temp;
};
@Module({
  imports: [
    MorganModule,
    AuthModule,
    CurriculumModule,
    QuestionModule,
    ExportModule,
    ResultModule,
    ImportModule,
    ScheduleModule.forRoot(),
    TeacherModule,
    LessonModule,
    GradeModule,
    LevelModule,
    StudentModule,
    AccessModule,
    ReportModule,
    SchoolModule,
  ],

  controllers: [AppController],
  providers: [...providers(), TasksService],
})
export class AppModule {}
