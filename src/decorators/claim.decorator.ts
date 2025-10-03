import { SetMetadata } from '@nestjs/common';
import { Role } from '../models/enums/role.enum';

export const Claim = (...claims: Role[]) => SetMetadata('claims', claims);
export const Key = 'claims';
