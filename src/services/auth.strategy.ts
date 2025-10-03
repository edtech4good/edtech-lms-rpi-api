import { TokenType } from './../models/enums';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { jwtoptionsbuilder } from './util.service';
import { TokenBusiness } from 'src/business/token.business';

const validateToken = async (payload: any) => {
  if (await new TokenBusiness().tokenExists(payload.jti)) {
    return { ...payload };
  }
  else {
    throw new UnauthorizedException();
  }
}


@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, `jwt-${TokenType.ACCESS}`) {
  constructor() {
    super(jwtoptionsbuilder(TokenType.ACCESS));
  }

  async validate(payload: any) {
    return validateToken(payload);
  }
}
