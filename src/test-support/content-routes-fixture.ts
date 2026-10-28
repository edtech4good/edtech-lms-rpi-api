import { Op } from "sequelize";
import * as contentAccess from "src/business/content-access";
import { Logger } from "src/config";
import { curriculums } from "src/models/data-models/curriculums";
import { documents } from "src/models/data-models/documents";
import { grades } from "src/models/data-models/grades";
import { initModels } from "src/models/data-models/init-models";
import { lessonlearningdocuments } from "src/models/data-models/lessonlearningdocuments";
import { lessonlearnings } from "src/models/data-models/lessonlearnings";
import { lessonplans } from "src/models/data-models/lessonplan";
import { lessonpracticequestions } from "src/models/data-models/lessonpracticequestions";
import { lessonpractices } from "src/models/data-models/lessonpractices";
import { lessonquizquestions } from "src/models/data-models/lessonquizquestions";
import { lessonquizzes } from "src/models/data-models/lessonquizzes";
import { lessons } from "src/models/data-models/lessons";
import { levelquizquestions } from "src/models/data-models/levelquizquestions";
import { levels } from "src/models/data-models/levels";
import { questions } from "src/models/data-models/questions";
import { students } from "src/models/data-models/students";
import { studentgradesprogress } from "src/models/data-models/studentgradesprogress";
import { studentlearningprogress } from "src/models/data-models/studentlearningprogress";
import { studentlessonsprogress } from "src/models/data-models/studentlessonsprogress";
import { studentlevelsprogress } from "src/models/data-models/studentlevelsprogress";
import { studentprogress } from "src/models/data-models/studentprogress";
import { CurriculumController } from "src/modules/curriculum/curriculum.controller";
import { GradeController } from "src/modules/grade/grade.controller";
import { LessonController } from "src/modules/lesson/lesson.controller";
import { LessonLearningController } from "src/modules/lesson/lesson.learning.controller";
import { LevelController } from "src/modules/level/level.controller";
import { QuestionController } from "src/modules/question/question.controller";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";

/**
 * The content routes the learner app reads, driven through their REAL controllers and business classes over an
 * in-memory fake of the models (rows are built as real Sequelize instances, so `get`, `getDataValue`,
 * `setDataValue` and `toJSON` are Sequelize's own). One small tree of content for organisation X, and a copy of its ids' content for
 * nothing else: a translation of another organisation's is a row of `contenttranslations`, not of this tree.
 *
 * What is faked: the database (equality and `Op.in` on the columns the code reads; includes are not evaluated, the
 * rows an include would bring are attached by hand where a route needs them), and `enrolledCurriculumIds`.
 * What is real: every controller and business method listed in `ROUTES`.
 *
 * It names nothing that did not exist before bilingual content, so it also runs against the code of `main`: the
 * no-header snapshots in `content-routes.snapshot.spec.ts` were taken that way.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const ORG_X = "a1000000-0000-4000-8000-00000000000a";
export const ORG_Y = "b2000000-0000-4000-8000-00000000000b";

/** A learner of organisation X. */
export const LEARNER: Token = {
  studentid: "s1",
  schooluserid: "su1",
  schoolusername: "learner1",
  studentfirstname: "Learner",
  schoolid: "school-x",
  organisationid: ORG_X,
};
/** A learner of organisation Y (the same routes, the other organisation's token). */
export const LEARNER_Y: Token = { ...LEARNER, studentid: "s2", schooluserid: "su2", schoolid: "school-y", organisationid: ORG_Y };

export const IDS = {
  curriculum: "c1",
  grade: "g1",
  level: "lv1",
  lesson: "ls1",
  lesson2: "ls2",
  learning: "ll1",
  practice: "pr1",
  quiz: "qz1",
  plan: "pl1",
  document: "d1",
  choice: "q1", // template 1
  typed: "q21", // template 21
  blank: "q8", // template 8
  optionA: "00000000-0000-4000-8000-0000000000a1",
  optionB: "00000000-0000-4000-8000-0000000000a2",
  typedOption: "00000000-0000-4000-8000-0000000000b1",
};

const option = (questionoptionid: string, questionoptiontext: string, sequence: number, iscorrect: boolean): Row => ({
  questionoptionid,
  questionoptiontext,
  questionoptionsequence: sequence,
  questionoptioniscorrect: iscorrect,
  questionassociate: null,
  questionoptionfile: null,
});

export const CONTENT: Record<string, Row[]> = {
  curriculums: [{ curriculumid: "c1", curriculumname: "Mathematics", curriculumstatus: true, curriculumdescription: "Numbers and shapes", isdeleted: false, subjectid: null, organisationid: ORG_X }],
  grades: [{ gradeid: "g1", curriculumid: "c1", gradename: "Grade One", gradedescription: "The first grade", gradeorder: 1, gradestatus: true, isdeleted: false, points: 100 }],
  levels: [{ levelid: "lv1", gradeid: "g1", levelname: "Level A", leveldescription: "An introduction", levelorder: 1, levelstatus: true, isdeleted: false, points: 50 }],
  lessons: [
    { lessonid: "ls1", levelid: "lv1", lessonname: "Counting", lessondescription: "Count to ten", lessonorder: 1, lessonstatus: true, isdeleted: false, total_points: 100, passing_points: 80 },
    { lessonid: "ls2", levelid: "lv1", lessonname: "Adding", lessondescription: "Add small numbers", lessonorder: 2, lessonstatus: true, isdeleted: false, total_points: 100, passing_points: 80 },
  ],
  lessonlearnings: [
    { lessonlearningid: "ll1", lessonid: "ls1", lessonlearningname: "Watch the video", lessonlearningdescription: "A short film", lessonlearningorder: 1, lessonlearningstatus: true, lessonlearningtype: "video", lessonlearningbody: null, documentid: "d1" },
  ],
  lessonpractices: [{ lessonpracticeid: "pr1", lessonid: "ls1", lessonpracticename: "Practice counting", lessonpracticedescription: "Try it", lessonpracticeorder: 1, lessonpracticestatus: true }],
  lessonquizzes: [{ lessonquizid: "qz1", lessonid: "ls1", lessonquizname: "Counting quiz", lessonquizdescription: "Test it", lessonquizorder: 1, lessonquizstatus: true }],
  lessonplans: [{ lessonplanid: "pl1", lessonid: "ls1", lessonplanname: "Teaching plan", lessonplandescription: "For the teacher", lessonplanorder: 1, lessonplanstatus: true }],
  documents: [{ documentid: "d1", documenttypeid: 2, documentname: "video.mp4", isdeleted: false, organisationid: ORG_X }],
  questions: [
    {
      questionid: "q1",
      templatetypeid: 1,
      questiontext: "Which number is larger?",
      questionheading: { headingfile: null, headingtext: "Larger" },
      questionoptions: [option(IDS.optionA, "7", 1, false), option(IDS.optionB, "12", 2, true)],
      questiondistractors: [],
      questionfeedback: { correctmessage: "Well done", incorrectmessage: "Try again" },
      questionstatus: true,
      isdeleted: false,
      organisationid: ORG_X,
    },
    {
      questionid: "q21",
      templatetypeid: 21,
      questiontext: "Type ----- the number",
      questionheading: { headingfile: null, headingtext: "Typing" },
      questionoptions: [option(IDS.typedOption, "twelve", 1, true)],
      questiondistractors: [],
      questionfeedback: null,
      questionstatus: true,
      isdeleted: false,
      organisationid: ORG_X,
    },
  ],
  lessonpracticequestions: [
    { lessonpracticequestionid: "prq1", lessonpracticeid: "pr1", questionid: "q1", lessonpracticequestionstatus: true, lessonpracticequestionorder: 1 },
    { lessonpracticequestionid: "prq2", lessonpracticeid: "pr1", questionid: "q21", lessonpracticequestionstatus: true, lessonpracticequestionorder: 2 },
  ],
  lessonquizquestions: [{ lessonquizquestionid: "qzq1", lessonquizid: "qz1", questionid: "q1", lessonquizquestionstatus: true, lessonquizquestionorder: 1 }],
  levelquizquestions: [],
  students: [{ studentid: "s1", schooluserid: "su1" }, { studentid: "s2", schooluserid: "su2" }],
};

const matches = (row: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === "object") {
      const list = (cond as Record<symbol, unknown[]>)[Op.in as unknown as symbol];
      if (list) return list.includes(row[key]);
      if (Op.ne in cond) return row[key] !== (cond as Record<symbol, unknown>)[Op.ne as unknown as symbol];
    }
    return row[key] === cond;
  });

const build = (model: any, row: Row): any => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const instance = model.build({ ...row });
  instance.isNewRecord = false;
  return instance;
};

/** What an include would have brought: a lesson with its learnings, practices, quizzes (and plans), a practice question with its question. */
const withIncludes = (name: string, instance: any, row: Row, options: any): any => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const find = (table: string, where: Row, model: any) => (CONTENT[table] ?? []).filter((r) => matches(r, where)).map((r) => build(model, r));
  if (name === "lessons" && Array.isArray(options?.include)) {
    instance.setDataValue("lessonlearnings", find("lessonlearnings", { lessonid: row.lessonid }, lessonlearnings));
    instance.setDataValue("lessonpractices", find("lessonpractices", { lessonid: row.lessonid }, lessonpractices));
    instance.setDataValue("lessonquizzes", find("lessonquizzes", { lessonid: row.lessonid }, lessonquizzes));
    if (options.include.length > 3) instance.setDataValue("lessonplans", find("lessonplans", { lessonid: row.lessonid }, lessonplans));
  }
  if (name === "lessonpracticequestions" || name === "lessonquizquestions") {
    const q = CONTENT.questions.find((r) => r.questionid === row.questionid);
    if (q) instance.setDataValue("question", build(questions, q));
  }
  return instance;
};

const MODELS: Array<[string, any]> = [ // eslint-disable-line @typescript-eslint/no-explicit-any
  ["curriculums", curriculums],
  ["grades", grades],
  ["levels", levels],
  ["lessons", lessons],
  ["lessonlearnings", lessonlearnings],
  ["lessonpractices", lessonpractices],
  ["lessonquizzes", lessonquizzes],
  ["lessonplans", lessonplans],
  ["documents", documents],
  ["questions", questions],
  ["lessonpracticequestions", lessonpracticequestions],
  ["lessonquizquestions", lessonquizquestions],
  ["levelquizquestions", levelquizquestions],
  ["students", students],
];
const EMPTY: Array<[string, any]> = [ // eslint-disable-line @typescript-eslint/no-explicit-any
  ["lessonlearningdocuments", lessonlearningdocuments],
  ["studentgradesprogress", studentgradesprogress],
  ["studentlevelsprogress", studentlevelsprogress],
  ["studentlessonsprogress", studentlessonsprogress],
  ["studentlearningprogress", studentlearningprogress],
  ["studentprogress", studentprogress],
];

/** Every query the content routes make, answered from `CONTENT`. Call in `beforeEach`; `jest.restoreAllMocks()` undoes it. */
export const installContentFakes = (): void => {
  initModels(dbinstance.getdbinstance());
  jest.spyOn(Logger, "info").mockImplementation((() => Logger) as never);
  jest.spyOn(contentAccess, "enrolledCurriculumIds").mockResolvedValue(["c1"]);
  for (const [name, model] of MODELS) {
    jest.spyOn(model, "scope").mockReturnValue(model as never);
    jest.spyOn(model, "findAll").mockImplementation((async (options: any = {}) => // eslint-disable-line @typescript-eslint/no-explicit-any
      (CONTENT[name] ?? []).filter((r) => matches(r, options.where)).map((r) => withIncludes(name, build(model, r), r, options))) as never);
    jest.spyOn(model, "findOne").mockImplementation((async (options: any = {}) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const row = (CONTENT[name] ?? []).find((r) => matches(r, options.where));
      return row ? withIncludes(name, build(model, row), row, options) : null;
    }) as never);
    jest.spyOn(model, "count").mockImplementation((async (options: any = {}) => (CONTENT[name] ?? []).filter((r) => matches(r, options.where)).length) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  for (const [, model] of EMPTY) {
    jest.spyOn(model, "scope").mockReturnValue(model as never);
    jest.spyOn(model, "findAll").mockResolvedValue([] as never);
    jest.spyOn(model, "findOne").mockResolvedValue(null as never);
  }
};

/** The body a route answers, as the client receives it. */
export const asJson = (body: unknown): any => JSON.parse(JSON.stringify(body)); // eslint-disable-line @typescript-eslint/no-explicit-any

/** The controllers of `main` take no header argument, so the routes are called through `any` (the extra argument is ignored there). */
const any = (controller: unknown): any => controller; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The routes (the header is passed as the controller's last argument; the code of `main` has no such argument and
 * ignores it). `steps` carries no learner text, so the header changes nothing there.
 */
export const ROUTES: Record<string, (user: Token, header?: string) => Promise<unknown>> = {
  "GET curriculum/subjects": (user, header) => any(new CurriculumController()).getAllCurriculumsWithSubjects(user, header),
  "GET grade/curriculum/:curriculumid": (user, header) => any(new GradeController()).getgradesbycurriculumid(IDS.curriculum, user, header),
  "GET level/grade/:gradeid": (user, header) => any(new LevelController()).getlevelsbygradeid(IDS.grade, user, header),
  "GET level/library": (user, header) => any(new LevelController()).getlibrary(user, header),
  "GET lesson/level/:levelid": (user, header) => any(new LessonController()).getlessonbylevelid(IDS.level, user, header),
  "GET lesson/level/:levelid/steps": (user) => any(new LessonController()).getlevelactivitiesprogress(IDS.level, user),
  "GET lesson/:lessonid/learning": (user, header) => any(new LessonLearningController()).getlessonbricks(IDS.lesson, user, header),
  "GET lesson/learning/:lessonlearningid": (user, header) => any(new LessonLearningController()).getlearning(IDS.learning, user, header),
  "GET question/practice/:lessonpracticeid": (user, header) => any(new QuestionController()).getpracticequestion(IDS.practice, user, header),
  "GET question/quiz/:lessonquizid": (user, header) => any(new QuestionController()).getquizquestion(IDS.quiz, user, header),
};
