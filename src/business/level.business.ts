import { col, fn, literal, Op, WhereOptions } from "sequelize";
import { lessons } from "src/models/data-models/lessons";
import { levels, levelsAttributes } from "src/models/data-models/levels";
import { studentlessonsprogress } from "src/models/data-models/studentlessonsprogress";
import { studentlevelsprogress } from "src/models/data-models/studentlevelsprogress";
import { COMPLETED_PERCENTAGE } from "src/models/enums/constant.enum";
import { Token } from "src/models/token.model";

export class LevelBusiness {
  getlevelsbygradeid = async (gradeid: string, user: Token) => {
    levels.hasMany(studentlevelsprogress, { foreignKey: "levelid" });
    studentlevelsprogress.belongsTo(levels, { foreignKey: "levelid" });
    let lvs = await levels.findAll({
      where: { gradeid, levelstatus: true, isdeleted: false },
      include: {
        model: studentlevelsprogress,
        required: false,
        where: { studentid: user.studentid },
        attributes: ["points", "completed"],
      },
    });
    lvs = lvs.map((level: levels) => {
      const studentlevelsprogress = level.getDataValue("studentlevelsprogresses");
      let progress = 0;
      if(studentlevelsprogress && studentlevelsprogress[0]?.points){
        progress = Number(Number(studentlevelsprogress[0]?.points*100/level.points).toFixed(2));
      }
      level.setDataValue("progress", progress);
      return level;
    });
    return lvs;
  };

  getlevelbylevelid = async (levelid: string, user: Token) => {
    levels.hasMany(studentlevelsprogress, { foreignKey: "levelid" });
    studentlevelsprogress.belongsTo(levels, { foreignKey: "levelid" });
    const lv = await levels.findOne({
      where: { levelid, levelstatus: true, isdeleted: false },
      include: {
        model: studentlevelsprogress,
        required: false,
        where: { studentid: user.studentid },
        attributes: ["points", "completed", "scores"],
      },
    });
    return lv;
  }

  isexistsLevelID = async (levelid: string) => {
    const where: WhereOptions<levelsAttributes> = {
      levelid,
      isdeleted: false,
    };
    const tempdt = await levels.count({ where });
    return tempdt > 0;
  };

  getuserlevelsprogress = async (gradeid: string, user: Token) => {
    levels.hasMany(studentlevelsprogress, {
      foreignKey: "levelid",
      sourceKey: "levelid",
    });
    studentlevelsprogress.belongsTo(levels, {
      foreignKey: "levelid",
    });
    lessons.hasMany(studentlessonsprogress, {
      foreignKey: "lessonid",
      sourceKey: "lessonid",
    });
    studentlessonsprogress.belongsTo(lessons, {
      foreignKey: "lessonid",
    });
    const levelsresult = await levels.findAll({
      where: { gradeid, levelstatus: true, isdeleted: false },
      attributes: [
        "levelid",
        "levelname",
        "levelorder",
        [fn("COUNT", col("lessons.lessonid")), "number_lessons"],
      ],
      include: [
        {
          model: studentlevelsprogress,
          required: false,
          where: { studentid: user.studentid },
          attributes: ["points","completed","scores"],
        },
        {
          model: lessons,
          as: "lessons",
          required: false,
          where: { lessonstatus: true, isdeleted: false },
          attributes: [],
        },
      ],
      group: ["levels.levelid"],
    });
    const lessonsprogresses = await lessons
      .findAll({
        where: { lessonstatus: true, isdeleted: false },
        attributes: ["lessonid", "lessonname", "levelid", "total_points"],
        include: [
          {
            model: studentlessonsprogress,
            required: true,
            where: {
              gradeid,
              studentid: user.studentid,
            },
            attributes: ["points"],
          },
        ],
      })
      .then((lsprogresses) => {
        return lsprogresses.map((lsprogress) => {
          const lvlstudentprogress = lsprogress.getDataValue(
            "studentlessonsprogresses"
          );
          if (lvlstudentprogress && lvlstudentprogress.length > 0) {
            const studentpoints = lvlstudentprogress[0].getDataValue("points") ?? 0;
            const completedpoints =
              (lsprogress.total_points * COMPLETED_PERCENTAGE) / 100;
            const completed =
              studentpoints > completedpoints ? true : false;
            lsprogress.setDataValue("completed", completed);
          }
          return lsprogress;
        });
      });
    let total_points = 0;
    for (const level of levelsresult) {
      const number_completed_levels = lessonsprogresses.filter(
        (lsp) => lsp.levelid === level.levelid && lsp.getDataValue("completed")
      ).length;
      level.setDataValue("number_completed_lessons", number_completed_levels);
      if (
        level.studentlevelsprogresses &&
        level.studentlevelsprogresses.length > 0
      ) {
        total_points += level.studentlevelsprogresses[0]?.scores ?? 0;
      }
    }
    return { levelsresult, total_points };
  };

  getLevelsWithFilter = async (gradeid: string, levelname: string) => {
    const where: WhereOptions<levelsAttributes> = {
      isdeleted: false,
      levelname: {
        [Op.like]: literal(`'%${levelname.trim()}%'`)
      }
    };
    if(gradeid){
      where.gradeid = gradeid;
    }  
    const order = ["levelname"];

    return await levels.findAll({ where, order });
  };
}
