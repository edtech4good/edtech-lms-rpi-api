import { Op, WhereOptions } from "sequelize";
import { lessonPassMark } from "src/business/lesson.business";
import { lessons } from "src/models/data-models/lessons";
import { levels, levelsAttributes } from "src/models/data-models/levels";
import { studentlessonsprogress } from "src/models/data-models/studentlessonsprogress";
import { studentlevelsprogress } from "src/models/data-models/studentlevelsprogress";
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
      attributes: ["levelid", "levelname", "levelorder"],
      include: [
        {
          model: studentlevelsprogress,
          required: false,
          where: { studentid: user.studentid },
          attributes: ["points","completed","scores"],
        },
      ],
    });
    // The query above used to include `lessons` (for a COUNT aggregate) and
    // `group: ["levels.levelid"]`. Under ONLY_FULL_GROUP_BY, MySQL rejected
    // that: the studentlevelsprogresses include auto-selects its primary key
    // (studentlevelsprogresses.studentlevelprogressid), which is not
    // functionally dependent on levels.levelid, so it had to appear in the
    // GROUP BY too (issue #43). The `group` was the actual problem; removing
    // it also removes the aggregate and the `lessons` include, so
    // number_lessons is now computed in JS from a plain, ungrouped lessons
    // query instead. Note: the old grouped COUNT was inflated for any
    // student with more than one studentlevelsprogress row for a level (the
    // include fanned out), so this count can come out lower than before for
    // such students; for the same reason, studentlevelsprogresses below may
    // now hold more than one element instead of always one.
    const levelids = levelsresult.map((level) => level.levelid);
    const lessoncounts = await lessons.findAll({
      where: { lessonstatus: true, isdeleted: false, levelid: { [Op.in]: levelids } },
      attributes: ["levelid"],
    });
    const number_lessons_by_levelid = new Map<string, number>();
    for (const lesson of lessoncounts) {
      const levelid = lesson.getDataValue("levelid");
      number_lessons_by_levelid.set(levelid, (number_lessons_by_levelid.get(levelid) ?? 0) + 1);
    }
    const lessonsprogresses = await lessons
      .findAll({
        where: { lessonstatus: true, isdeleted: false },
        attributes: ["lessonid", "lessonname", "levelid", "total_points", "passing_points"],
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
            const completed =
              studentpoints >= lessonPassMark(lsprogress) ? true : false;
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
      level.setDataValue("number_lessons", number_lessons_by_levelid.get(level.levelid) ?? 0);
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
        [Op.like]: `%${levelname.trim()}%`
      }
    };
    if(gradeid){
      where.gradeid = gradeid;
    }  
    const order = ["levelname"];

    return await levels.findAll({ where, order });
  };
}
