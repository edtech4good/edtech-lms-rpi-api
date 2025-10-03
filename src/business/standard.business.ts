import { BadRequestException } from "@nestjs/common";
import { literal, Op, WhereOptions } from "sequelize";
import { standards, standardsAttributes } from "src/models/data-models/standards";

export class StandardBusiness {
  getStandardsWithFilter = async (schoolname: string, standardname: string) => {
    if(!schoolname) throw new BadRequestException('No school name!');
    const where: WhereOptions<standardsAttributes> = {
      isdeleted: false,
      standardname: {
        [Op.like]: literal(`'%${standardname.trim()}%'`),
      },
      schoolname
    };
    const order = ["standardname"];
    const attributes = ['standardid', 'standardname'];

    return await standards.findAll({ where, order, attributes });
  };
}
