import { ValidationError, ValidationErrorItem } from "joi";
import { LessonBusiness } from "src/business/lesson.business";
import { IRequest } from "src/models";

export const DeleteLesson = async (
  request: IRequest,
  data: any
): Promise<Array<ValidationError | null | undefined>> => {
  const lessonexists = await new LessonBusiness().isexistsLessonID(data.lessonid);
  if (!lessonexists) {
    const error = new ValidationError("Validation", {}, {});
    error.details = [];
    const erroritem: ValidationErrorItem = {
      message: "",
      path: [""],
      type: "",
    };
    erroritem.message = "Invalid Lesson id";
    error.details.push(erroritem);
    return [error];
  }
  return [];
};
