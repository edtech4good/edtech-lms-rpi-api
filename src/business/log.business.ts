/* eslint-disable @typescript-eslint/no-explicit-any */
import { subMonths } from "date-fns";
import { Op } from "sequelize";
import { rpiuseraccess, studentprogress, studentprogressquestions } from "src/models/data-models/init-models";
import { ReportScope } from "./report-scope";
import { SyncReport } from "./sync.report";
export class LogBusiness {
    /**
     * The six months of progress, results, sign-ins and usage in the log zip (`GET export/log`): the same rows the report
     * data carries, from the same reader, so the two cannot drift apart. `scope` is whose rows they may be (`null` is the
     * whole server; see export-scope.ts).
     */
    exportlog = async (scope: ReportScope | null) => ({
        log: await new SyncReport().getstudentdata(scope),
    });
    cleanlog = async () => {
        const limitdate = subMonths(new Date(), 6);
        const sp = (
            await studentprogress.findAll({
                where: {
                    starttime: { [Op.lt]: limitdate },
                },
                include: ["studentprogressid"]
            })
        )
        await studentprogressquestions.destroy({
            where: {
                studentprogressid: {
                    [Op.in]: sp.map((x) => x.studentprogressid),
                },
            },
        });
        await studentprogress.destroy({
            where: {
                studentprogressid: {
                    [Op.in]: sp.map((x) => x.studentprogressid),
                },
            },
        })
        await rpiuseraccess.destroy({
            where: {
                logintime: { [Op.lt]: limitdate },
            },
        });

    };
}
