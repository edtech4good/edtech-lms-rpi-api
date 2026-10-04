import { ApiError } from "src/models/ApiError";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { Op, WhereOptions } from "sequelize";
import { standards, standardsAttributes } from "src/models/data-models/standards";
import { SchoolScope, schoolPredicate } from "./school-identity";

export class StandardBusiness {
  /**
   * The classes of a school (its id, or its name while no school row has reached
   * this server). `undefined` means the caller named no school at all, which is
   * refused as before.
   */
  getStandardsWithFilter = async (school: SchoolScope | undefined, standardname: string) => {
    if(school === undefined) throw new ApiError(ErrorCode.INVALID_INPUT, { message: 'A school name is required.' });
    const where: WhereOptions<standardsAttributes> = {
      isdeleted: false,
      standardname: {
        [Op.like]: `%${standardname.trim()}%`,
      },
      ...schoolPredicate(school),
    };
    const order = ["standardname"];
    const attributes = ['standardid', 'standardname'];

    return await standards.findAll({ where, order, attributes });
  };
}
