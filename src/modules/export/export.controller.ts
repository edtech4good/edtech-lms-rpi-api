import * as fs from 'fs';
import {
  Controller,
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
import { TokenType } from "src/models/enums";
import { LOGDIR, LOGTYPE } from "src/models/enums/logaccess.enum";
import { Token } from "src/models/token.model";
import { SyncReport } from 'src/business/sync.report';

@ApiTags("Export")
@Controller("export")
@ApiBearerAuth()
export class ExportController {
  @Get("log")
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @HttpCode(HttpStatus.OK)
  async exportlog(
    @Response({ passthrough: true }) res: any,
    @User() user: Token
  ): Promise<any> {
    const log = await new LogBusiness().exportlog();
    const zip = new AdmZip();
    zip.addFile("log.ini", Buffer.from(JSON.stringify(log || []), "utf8"));
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
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="log-${new Date().toLocaleDateString()}-${new Date().toLocaleTimeString()}.zip"`,
    });
    Logger.info(`<${user.schoolusername}> export log`, {logaccesstype: LOGTYPE.EXPORTLOG, userid: user.schooluserid});
    return new StreamableFile(zip.toBuffer());
  }

  @Get("system-log/files")
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @HttpCode(HttpStatus.OK)
  async exportfiles(
    @Response({ passthrough: true }) res: any,
    @User() user: Token
  ): Promise<any> {
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
    Logger.info(`<${user.schoolusername}> export log-files`, {logaccesstype: LOGTYPE.EXPORTLOGFILES, userid: user.schooluserid});
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="logfiles-${user.schoolname ?? ''}-${new Date().toLocaleDateString()}-${new Date().toLocaleTimeString()}.zip"`,
    });
    return new StreamableFile(zip.toBuffer());
  }

  @Get("report-data")
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
  @UseGuards(AccessGuard(TokenType.ACCESS))
  async getReportData(@Response({ passthrough: true }) res: any) {
    const zip = new AdmZip();
    zip.addFile(
      "syncfile.ini",
      Buffer.from(await new SyncReport().getreportdata())
    );
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="sync-data.zip"`,
    });
    return new StreamableFile(zip.toBuffer());
  }
}
