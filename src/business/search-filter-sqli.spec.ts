/**
 * Guards the remaining five "search endpoints" from #16 ("Security:
 * authenticate report endpoints + parameterize all SQLi sites"): each
 * business method builds a Sequelize `where` clause with the caller's
 * search term under `Op.like`. Before #16 these used `sequelize.literal`
 * with the term spliced directly into raw SQL text; now the term is an
 * `Op.like` VALUE, which Sequelize binds as a parameter when it generates
 * SQL. Mocking each model's `findAll`/`findOne` and reading back the
 * `where` clause the business method built proves the term is bound data,
 * not a literal SQL fragment.
 *
 * (getStudentsWithFilter, the sixth search endpoint, is covered in
 * student.business.spec.ts alongside the rest of StudentBusiness.)
 */
import { curriculums } from "src/models/data-models/curriculums";
import { grades } from "src/models/data-models/grades";
import { lessons } from "src/models/data-models/lessons";
import { levels } from "src/models/data-models/levels";
import { standards } from "src/models/data-models/standards";
import { CurriculumBusiness } from "./curriculum.business";
import { GradeBusiness } from "./grade.business";
import { LessonBusiness } from "./lesson.business";
import { LevelBusiness } from "./level.business";
import { StandardBusiness } from "./standard.business";

const HOSTILE = "1 OR 1=1; --";

const likeValueOf = (where: any, field: string): unknown => {
  const clause = where[field];
  const likeSymbol = Object.getOwnPropertySymbols(clause)[0];
  return clause[likeSymbol];
};

describe("search-endpoint SQL parameterization (#16)", () => {
  it("CurriculumBusiness.getCurriculumsWithFilter binds the search term via Op.like, not sequelize.literal", async () => {
    const spy = jest.spyOn(curriculums, "findAll").mockResolvedValue([] as never);
    try {
      await new CurriculumBusiness().getCurriculumsWithFilter(HOSTILE, "", "", "");
      const options: any = spy.mock.calls[0][0];
      expect(likeValueOf(options.where, "curriculumname")).toBe(`%${HOSTILE}%`);
      expect(typeof options.where.curriculumname.val).toBe("undefined");
    } finally {
      spy.mockRestore();
    }
  });

  it("GradeBusiness.getGradesWithFilter binds the search term via Op.like, not sequelize.literal", async () => {
    const spy = jest.spyOn(grades, "findAll").mockResolvedValue([] as never);
    try {
      await new GradeBusiness().getGradesWithFilter(HOSTILE, "", "", "");
      const options: any = spy.mock.calls[0][0];
      expect(likeValueOf(options.where, "gradename")).toBe(`%${HOSTILE}%`);
      expect(typeof options.where.gradename.val).toBe("undefined");
    } finally {
      spy.mockRestore();
    }
  });

  it("LessonBusiness.getLessonsWithFilter binds the search term via Op.like, not sequelize.literal", async () => {
    const spy = jest.spyOn(lessons, "findAll").mockResolvedValue([] as never);
    try {
      await new LessonBusiness().getLessonsWithFilter("", HOSTILE);
      const options: any = spy.mock.calls[0][0];
      expect(likeValueOf(options.where, "lessonname")).toBe(`%${HOSTILE}%`);
      expect(typeof options.where.lessonname.val).toBe("undefined");
    } finally {
      spy.mockRestore();
    }
  });

  it("LevelBusiness.getLevelsWithFilter binds the search term via Op.like, not sequelize.literal", async () => {
    const spy = jest.spyOn(levels, "findAll").mockResolvedValue([] as never);
    try {
      await new LevelBusiness().getLevelsWithFilter("", HOSTILE);
      const options: any = spy.mock.calls[0][0];
      expect(likeValueOf(options.where, "levelname")).toBe(`%${HOSTILE}%`);
      expect(typeof options.where.levelname.val).toBe("undefined");
    } finally {
      spy.mockRestore();
    }
  });

  it("StandardBusiness.getStandardsWithFilter binds the search term via Op.like, not sequelize.literal", async () => {
    const spy = jest.spyOn(standards, "findAll").mockResolvedValue([] as never);
    try {
      await new StandardBusiness().getStandardsWithFilter("some-school", HOSTILE);
      const options: any = spy.mock.calls[0][0];
      expect(likeValueOf(options.where, "standardname")).toBe(`%${HOSTILE}%`);
      expect(typeof options.where.standardname.val).toBe("undefined");
    } finally {
      spy.mockRestore();
    }
  });
});
