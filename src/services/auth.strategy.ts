import { TokenType } from './../models/enums';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { jwtoptionsbuilder } from './util.service';
import { TokenBusiness } from 'src/business/token.business';
import { checkTokenClaims } from 'src/business/token-claims';
import { isPiBootstrapRoute } from 'src/guards/pi-bootstrap';

const validateToken = async (payload: any, request?: object) => {
  if (await new TokenBusiness().tokenExists(payload.jti)) {
    // The token must name a school of an organisation that is here and active
    // (see business/token-claims.ts for the rule and its one classroom-Pi exception).
    await checkTokenClaims(payload, { piBootstrapRoute: isPiBootstrapRoute(request) });
    return { ...payload };
  }
  else {
    throw new UnauthorizedException();
  }
}


@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, `jwt-${TokenType.ACCESS}`) {
  constructor() {
    super({ ...jwtoptionsbuilder(TokenType.ACCESS), passReqToCallback: true });
  }

  async validate(request: object, payload: any) {
    return validateToken(payload, request);
  }
}
