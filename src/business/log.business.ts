/* eslint-disable @typescript-eslint/no-explicit-any */
import { subMonths } from "date-fns";
import { groupBy } from "lodash";
import { Op } from "sequelize";
import { rpiuseraccess, studentactives, studentgradesprogress, studentlearningprogress, studentlessonsprogress, studentlevelsprogress, studentpoints, studentprogress, studentprogressquestions } from "src/models/data-models/init-models";
import { studentappusages } from "src/models/data-models/studentappusage";
export class LogBusiness {
    exportlog = async () => {
        const limitdate = subMonths(new Date(), 6);
        const sp = (
            await studentprogress.findAll({
                where: {
                    starttime: { [Op.gt]: limitdate },
                },
            })
        ).map((x) => ({
            ...x.get({ plain: true }),
        }));
        const spqo = await studentprogressquestions.findAll({
            where: {
                studentprogressid: {
                    [Op.in]: sp.map((x) => x.studentprogressid),
                },
            },
        });
        const spq = spqo.map((x) => x.get({ plain: true }));
        const gspq = groupBy(spq, 'studentprogressid');
        const sa = await rpiuseraccess.findAll({
            where: {
                logintime: { [Op.gt]: limitdate },
            },
        });
        const stactives = (await studentactives.findAll({
            where: {
                created_at: { [Op.gt]: limitdate },
            }
        })).map((x) => ({
            ...x.get({ plain: true }),
        }));
        const stlp = (await studentlearningprogress.findAll({
            where: {
                lastupdated: { [Op.gt]: limitdate },
            }
        })).map((x) => ({
            ...x.get({ plain: true }),
        }));
        const stgp = (await studentgradesprogress.findAll({
            where: {
                lastupdated: { [Op.gt]: limitdate },
            }
        })).map((x) => ({
            ...x.get({ plain: true }),
        }));
        const stlvp = (await studentlevelsprogress.findAll({
            where: {
                lastupdated: { [Op.gt]: limitdate },
            }
        })).map((x) => ({
            ...x.get({ plain: true }),
        }));
        const stlsp = (await studentlessonsprogress.findAll({
            where: {
                lastupdated: { [Op.gt]: limitdate },
            }
        })).map((x) => ({
            ...x.get({ plain: true }),
        }));
        const stpoints = (await studentpoints.findAll({
            where: {
                created_at: { [Op.gt]: limitdate },
            }
        })).map((x) => ({
            ...x.get({ plain: true }),
        }));
        const stpusages = (await studentappusages.findAll({
            where: {
                created_at: { [Op.gt]: limitdate },
            }
        })).map((x) => ({
            ...x.get({ plain: true }),
        }));
        return {
            log: {
                result: sp.map((x) => ({
                    ...x,
                    studentprogressquestions: gspq[x.studentprogressid],
                })),
                progress: {
                    studentactives: stactives,
                    studentlearningprogress: stlp,
                    studentgradesprogress: stgp,
                    studentlevelsprogress: stlvp,
                    studentlessonsprogress: stlsp,
                    studentpoints: stpoints,
                    studentappusages: stpusages,
                },
                access: sa.map((x) => x.get({ plain: true })),
            },
        };
    };
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
