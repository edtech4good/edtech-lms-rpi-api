import { ApiExtraModels, ApiProperty } from '@nestjs/swagger';
import { IResponse } from '../../../models/IResponse';

export class LoginTokens {
  @ApiProperty()
  accessToken: string;


  constructor() {
    this.accessToken = "";
  }
}

@ApiExtraModels(LoginTokens)
export class LoginResponseModel extends IResponse<LoginTokens> {
  @ApiProperty({ type: () => LoginTokens })
  data: LoginTokens;

  constructor() {
    super();
    this.data = new LoginTokens();
  }
}
