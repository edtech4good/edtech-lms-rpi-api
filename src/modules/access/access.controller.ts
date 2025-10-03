import {
    Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiResponse, ApiBody } from "@nestjs/swagger";
import { AccessBusiness } from "src/business/access.business";
import { User } from "src/decorators/user.decorator";
import { AccessGuard } from "src/guards/access.guard";
import { SchemaValidationInterceptor } from "src/interceptors";
import { TokenType } from "src/models/enums";
import { Token } from "src/models/token.model";
import { accessDate } from "./access.request.validator";
import { AccessBody } from "./models/AccessRequest";

@ApiTags("Access")
@Controller("access")
@ApiBearerAuth()
export class AccessController {
  @Post()
  @ApiResponse({
    status: 200,
    description: "Access updated successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error update access",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @ApiBody({ required: true, type: () => AccessBody })
  @UseInterceptors(new SchemaValidationInterceptor(accessDate))
  @HttpCode(HttpStatus.OK)
  async access(
    @Body() body: AccessBody,
    @User() user: Token
  ): Promise<any> {
    await new AccessBusiness().updatestudentusage(body, user);
    return {
        data: "Update Access successfully",
        error: false,
    };
  }

  @Get()
  @ApiResponse({
    status: 200,
    description: "Fetched students usages successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching students usages",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @HttpCode(HttpStatus.OK)
  async getStudentsOfflineOnline(): Promise<any> {
    const data = await new AccessBusiness().getStudentsAccess();
    return {
        data: data,
        error: false,
    };
  }
}
