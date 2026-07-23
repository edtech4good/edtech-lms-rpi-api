import { Controller, Get, HttpCode, HttpStatus, Query } from "@nestjs/common";
import { ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SchoolBusiness } from "src/business/school.business";

@ApiTags("School")
@Controller("school")
export class SchoolController {
  // Intentionally unguarded: the app needs the school's branding before a
  // student has authenticated (login screen theming).
  @Get("branding")
  @ApiResponse({
    status: 200,
    description: "Fetched school branding successfully",
  })
  @ApiQuery({ name: "schoolname", required: false, type: "string" })
  @HttpCode(HttpStatus.OK)
  async getBranding(@Query("schoolname") schoolname?: unknown): Promise<any> {
    return {
      error: false,
      data: await new SchoolBusiness().getBranding(schoolname),
    };
  }
}
