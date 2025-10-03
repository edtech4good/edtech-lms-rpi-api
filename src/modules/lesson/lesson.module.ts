import { Module } from '@nestjs/common';
import { LessonController } from './lesson.controller';
import { LessonLearningController } from './lesson.learning.controller';
@Module({
  controllers: [LessonController, LessonLearningController],
})
export class LessonModule { }
