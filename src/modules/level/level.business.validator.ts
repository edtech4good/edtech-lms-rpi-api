import { ValidationError, ValidationErrorItem } from "joi";
import { LevelBusiness } from "src/business/level.business";
import { IRequest } from "src/models";

export const DeleteLevel = async (
  request: IRequest,
  data: any
): Promise<Array<ValidationError | null | undefined>> => {
  const levelexists = await new LevelBusiness().isexistsLevelID(data.levelid);
  if (!levelexists) {
    const error = new ValidationError("Validation", {}, {});
    error.details = [];
    const erroritem: ValidationErrorItem = {
      message: "",
      path: [""],
      type: "",
    };
    erroritem.message = "Invalid Level id";
    error.details.push(erroritem);
    return [error];
  }
  return [];
};
