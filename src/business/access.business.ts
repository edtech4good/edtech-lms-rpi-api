import { BadRequestException } from "@nestjs/common";
import { differenceInSeconds, startOfDay, startOfTomorrow } from "date-fns";
import { Op } from "sequelize";
import { studentappusages } from "src/models/data-models/studentappusage";
import { Token } from "src/models/token.model";
import { AccessBody } from "src/modules/access/models/AccessRequest";
import { v4 as uuidv4 } from "uuid";

export class AccessBusiness {
    updatestudentusage = async (body: AccessBody, user: Token) => {
        const startdate = new Date(body.starttime);
        const today = startOfDay(startdate);
        const tomorrow = startOfTomorrow();
        let seconds = differenceInSeconds(new Date(body.endtime), startdate);
        if(seconds < 0){
            seconds = 0;
        } else if(seconds > 86400) {
            seconds = 86400; // time-spent can not larger than a day
        }
        const studentusage = await studentappusages.findOne({
            where: {
                schooluserid: user.schooluserid,
                created_at: {
                    [Op.between]: [today, tomorrow]
                }
            }
        });
        if(!user.schooluserid) throw new BadRequestException('User does not exist.')
        if(!studentusage) {
            await studentappusages.create({
                studentappusageid: uuidv4(),
                schooluserid: user.schooluserid,
                time_spent: seconds ?? 0,
                last_updated: body.endtime,
                created_at: body.endtime
            });
        } else {
            studentusage.time_spent += seconds ?? 0;
            studentusage.last_updated = body.endtime;
            await studentusage.save({ fields: ['time_spent', 'last_updated'] });
        }
        return {seconds, studentusage};
    }

    getStudentsAccess = async () => {
        return await studentappusages.findAll();
    }
}