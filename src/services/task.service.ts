
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LogBusiness } from 'src/business/log.business';
import { Logger } from "src/config"
@Injectable()
export class TasksService {
    @Cron(CronExpression.EVERY_6_MONTHS)
    async handleCron() {
        //clean db
        Logger.info("logged cleaned : ", new Date())
        await new LogBusiness().cleanlog();
    }
}
