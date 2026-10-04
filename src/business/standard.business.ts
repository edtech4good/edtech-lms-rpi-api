import { ApiError } from "src/models/ApiError";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { Op, WhereOptions } from "sequelize";
import { standards, standardsAttributes } from "src/models/data-models/standards";

export class StandardBusiness {
  /**
   * The classes of a school, by its id. `undefined` means the caller named no
   * school at all, which is refused as before; `null` (a name that matches no
   * school) matches no classes.
   */
  getStandardsWithFilter = async (schoolid: string | null | undefined, standardname: string) => {
    if(schoolid === undefined) throw new ApiError(ErrorCode.INVALID_INPUT, { message: 'A school name is required.' });
    const where: WhereOptions<standardsAttributes> = {
      isdeleted: false,
      standardname: {
        [Op.like]: `%${standardname.trim()}%`,
      },
      schoolid: schoolid ?? { [Op.in]: [] },
    };
    const order = ["standardname"];
    const attributes = ['standardid', 'standardname'];

    return await standards.findAll({ where, order, attributes });
  };
}
