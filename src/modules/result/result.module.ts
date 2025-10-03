import { Module } from '@nestjs/common';
import { ResultController } from './result.controller';
@Module({
  controllers: [ResultController],
})
export class ResultModule { }
