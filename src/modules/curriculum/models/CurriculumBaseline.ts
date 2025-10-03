import { ApiProperty } from "@nestjs/swagger";

export class CurriculumBaselineDate {
  
    @ApiProperty({ example: (new Date(new Date().toUTCString())).getTime() })
    date?: string;
  
    constructor() {
      this.date = '';
    }
  }