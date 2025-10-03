import { ApiProperty } from '@nestjs/swagger';

export class LoginRequestBody {
  @ApiProperty()
  studentusername: string;

  @ApiProperty()
  studentpassword: string;

  @ApiProperty({ example: (new Date(new Date().toUTCString())).getTime() })
  logintime: string;

  constructor() {
    this.studentusername = '';
    this.studentpassword = '';
    this.logintime = '';
  }
}

export class LogoutRequestBody {
  @ApiProperty({ example: new Date().getTime() })
  logouttime: number;
  @ApiProperty()
  timespent: number;

  constructor() {
    this.logouttime = new Date().getTime();
    this.timespent = 0;
  }
}
