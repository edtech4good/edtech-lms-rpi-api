import * as fs from 'fs';
import { OrgPolicy } from "src/decorators/orgPolicy.decorator";
import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Response,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiResponse, ApiTags } from "@nestjs/swagger";
import AdmZip from "adm-zip";
import { LogBusiness } from "src/business/log.business";
import { Logger } from "src/config";
import { User } from "src/decorators/user.decorator";
import { AccessGuard } from "src/guards/access.guard";
import { ReportScopeGuard, ReportScopeOf } from "src/guards/report-scope.guard";
import { mayTakeServerLogs, storedSchoolNameOf } from "src/business/export-scope";
import { ReportScope } from "src/business/report-scope";
import { TokenType } from "src/models/enums";
import { LOGDIR, LOGTYPE } from "src/models/enums/logaccess.enum";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { Token } from "src/models/token.model";
import { attachmentDisposition } from "src/services/content-disposition";
import { SyncReport } from 'src/business/sync.report';

const STAFF_ROLES = [SchoolRole.ADMIN, SchoolRole.SUPERADMIN, SchoolRole.TEACHER];

/**
 * The three data exports of the student API. Each is confined to the caller's scope (business/report-scope.ts and
 * business/export-scope.ts), whatever the caller sends:
 *
 *  - a staff token (teacher, admin or super admin alike): its own school. An organisation's view of several schools
 *    is not served here;
 *  - the server sync key is not admitted on any of them (nothing calls them with it). The scope still knows the key's
 *    two views (an organisation's schools, and `platform` for the whole server), so a route that is given the key later
 *    is scoped the way the reports are.
 *
 * The server's own log files hold the ids and addresses of every user the server has seen, so they are never part of
 * an organisation's export: only the platform view, and a classroom Pi whose scope is every school on it, may take them.
 */
@ApiTags("Export")
@Controller("export")
@ApiBearerAuth()
export class ExportController {
  @Get("log")
  @UseGuards(AccessGuard(TokenType.ACCESS, ...STAFF_ROLES), ReportScopeGuard)
  @OrgPolicy("teacher", {
    note: "log.ini holds only the caller's school's learners and logins; the server's own log files are added only on a classroom Pi.",
    enforcedBy: "src/modules/export-scope.leak.spec.ts",
  })
  @HttpCode(HttpStatus.OK)
  async exportlog(
    @Response({ passthrough: true }) res: any,
    @User() user: Token,
    @ReportScopeOf() scope: ReportScope | null
  ): Promise<any> {
    const log = await new LogBusiness().exportlog(scope);
    const zip = new AdmZip();
    zip.addFile("log.ini", Buffer.from(JSON.stringify(log || []), "utf8"));
    if (await mayTakeServerLogs(scope)) {
      // add file from log
      const files = fs.readdirSync(LOGDIR);
      files.forEach(file => {
        try {
          if(file.includes('RPI-API-error') || file.includes('RPI-API-info')) {
            const data = fs.readFileSync(LOGDIR +'/' + file, 'utf8'); // synchronous
            zip.addFile(file, Buffer.from(data.toString(), "utf8"));
          }
        } catch (e) {
          throw new InternalServerErrorException("Error read file");
        }
      });
    }
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": attachmentDisposition(`log-${new Date().toLocaleDateString()}-${new Date().toLocaleTimeString()}.zip`),
    });
    Logger.info(`<${user.schoolusername ?? user.schooluserid}> export log`, {logaccesstype: LOGTYPE.EXPORTLOG, userid: user.schooluserid});
    return new StreamableFile(zip.toBuffer());
  }

  @Get("system-log/files")
  @UseGuards(AccessGuard(TokenType.ACCESS, ...STAFF_ROLES), ReportScopeGuard)
  @OrgPolicy("teacher", {
    note: "The server's own log files are served only on a classroom Pi; elsewhere the answer is the one for a role that is not allowed.",
    enforcedBy: "src/modules/export-scope.leak.spec.ts",
  })
  @HttpCode(HttpStatus.OK)
  async exportfiles(
    @Response({ passthrough: true }) res: any,
    @User() user: Token,
    @ReportScopeOf() scope: ReportScope | null
  ): Promise<any> {
    if (!(await mayTakeServerLogs(scope))) {
      throw new ForbiddenException();
    }
    const zip = new AdmZip();
    const files = fs.readdirSync(LOGDIR);
    files.forEach(file => {
      try {
        if(file.includes('RPI-API')) {
          const data = fs.readFileSync(LOGDIR +'/' + file, 'utf8'); // synchronous
          zip.addFile(file, Buffer.from(data.toString(), "utf8"));
        }
      } catch (e) {
        throw new InternalServerErrorException("Error read file");
      }
    });
    Logger.info(`<${user.schoolusername ?? user.schooluserid}> export log-files`, {logaccesstype: LOGTYPE.EXPORTLOGFILES, userid: user.schooluserid});
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": attachmentDisposition(`logfiles-${await storedSchoolNameOf(scope)}-${new Date().toLocaleDateString()}-${new Date().toLocaleTimeString()}.zip`),
    });
    return new StreamableFile(zip.toBuffer());
  }

  @Get("report-data")
  @UseGuards(AccessGuard(TokenType.ACCESS, ...STAFF_ROLES), ReportScopeGuard)
  @OrgPolicy("teacher", {
    note: "A token gets its own school's rows; the server key is not admitted. The scope also resolves an organisation id or platform, which no caller can reach here. Same zip and file name, only the rows differ.",
    enforcedBy: "src/modules/export-scope.leak.spec.ts",
  })
  @ApiResponse({
    status: 200,
    description: "Sync exported sucesfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while exporting Sync",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @HttpCode(HttpStatus.OK)
  async getReportData(@Response({ passthrough: true }) res: any, @ReportScopeOf() scope: ReportScope | null) {
    const zip = new AdmZip();
    zip.addFile(
      "syncfile.ini",
      Buffer.from(await new SyncReport().getreportdata(scope))
    );
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="sync-data.zip"`,
    });
    return new StreamableFile(zip.toBuffer());
  }
}
