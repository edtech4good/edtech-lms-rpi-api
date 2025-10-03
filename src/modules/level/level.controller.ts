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
import { ApiTags, ApiBearerAuth, ApiParam, ApiResponse, ApiQuery } from "@nestjs/swagger";
import { LevelBusiness } from "src/business/level.business";
import { Logger } from "src/config";
import { User } from "src/decorators/user.decorator";
import { AccessGuard } from "src/guards/access.guard";
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

  @Get('all')
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
    @Query("level") levelname: string = ''
  ): Promise<any> {
    const data = await new LevelBusiness().getLevelsWithFilter(gradeid, levelname);
    return {
        data: data,
        error: false,
    };
  }

  @Get("/grade/:gradeid")
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
