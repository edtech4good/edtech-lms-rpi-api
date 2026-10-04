import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { OrgPolicy } from "src/decorators/orgPolicy.decorator";
import { ApiTags, ApiBearerAuth, ApiParam, ApiResponse, ApiQuery } from "@nestjs/swagger";
import { LevelBusiness } from "src/business/level.business";
import { LibraryBusiness } from "src/business/library.business";
import { Logger } from "src/config";
import { User } from "src/decorators/user.decorator";
import { AccessGuard } from "src/guards/access.guard";
import { ContentAccessGuard } from "src/guards/content-access.guard";
import {
  SchemaValidationInterceptor,
  BusinessValidationInterceptor,
} from "src/interceptors";
import { TokenType } from "src/models/enums";
import { LOGTYPE } from "src/models/enums/logaccess.enum";
import { Token } from "src/models/token.model";
import { DeleteGrade } from "../grade/grade.business.validator";
import { showgradeid } from "../grade/grade.request.validator";

@ApiTags("Level")
@Controller("level")
@ApiBearerAuth()
@UseGuards(AccessGuard(TokenType.ACCESS))
export class LevelController {

  // A literal top-level route. Nothing else in this controller takes an
  // unparameterized top-level segment (the param routes are all nested,
  // e.g. "grade/:gradeid"), so there is no route here "library" could be
  // shadowed by regardless of declaration order.
  @Get("library")
  @OrgPolicy("learner", { enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @ApiResponse({
    status: 200,
    description: "Library fetched successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while fetching library",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @HttpCode(HttpStatus.OK)
  async getlibrary(@User() user: Token): Promise<any> {
    Logger.info(`<${user.studentfirstname}> get library`, {
      logaccesstype: LOGTYPE.GETLEVELS,
      userid: user.schooluserid,
    });
    return {
      data: await new LibraryBusiness().getLibrary(user),
      error: false,
    };
  }

  @Get('all')
  @OrgPolicy("learner", { enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @ApiResponse({
    status: 200,
    description: "Fetched levels successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching levels",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @ApiQuery({ name: "gradeid", required: false, type: 'string' })
  @ApiQuery({ name: "level", required: false, type: 'string' })
  @HttpCode(HttpStatus.OK)
  async getAllLevels(
    @Query("gradeid") gradeid: string = '',
    @Query("level") levelname: string = '',
    @User() user?: Token
  ): Promise<any> {
    const data = await new LevelBusiness().getLevelsWithFilter(gradeid, levelname, user);
    return {
        data: data,
        error: false,
    };
  }

  @Get("/grade/:gradeid")
  @OrgPolicy("learner", { enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @UseGuards(ContentAccessGuard("grade", "gradeid"))
  @ApiResponse({
    status: 200,
    description: "Levels fetch successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while fetching Levels",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseInterceptors(
    new SchemaValidationInterceptor(showgradeid),
    new BusinessValidationInterceptor([DeleteGrade])
  )
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `gradeid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getlevelsbygradeid(
    @Param("gradeid") gradeid: string,
    @User() user: Token
    ): Promise<any> {
    Logger.info(`<${user.studentfirstname}> get all levels <${gradeid}>`, {logaccesstype: LOGTYPE.GETLEVELS, userid: user.schooluserid});
    return {
      data: await new LevelBusiness().getlevelsbygradeid(gradeid, user),
      error: false,
    };
  }

  @Get("progress/grade/:gradeid")
  @OrgPolicy("learner", { enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @UseGuards(ContentAccessGuard("grade", "gradeid"))
  @ApiResponse({
    status: 200,
    description: "Levels fetch successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while fetching Levels",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseInterceptors(
    new SchemaValidationInterceptor(showgradeid),
    new BusinessValidationInterceptor([DeleteGrade])
  )
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `gradeid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getuserlevelsprogress(
    @Param("gradeid") gradeid: string,
    @User() user: Token
    ): Promise<any> {
    Logger.info(`<${user.studentfirstname}> get all levels progress <${gradeid}>`, {logaccesstype: LOGTYPE.GETLEVELSPROGRESS, userid: user.schooluserid});
    return {
      data: await new LevelBusiness().getuserlevelsprogress(gradeid, user),
      error: false,
    };
  }
}
