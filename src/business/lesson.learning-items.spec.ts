import { Op } from "sequelize";
import { documents } from "src/models/data-models/documents";
import { lessonlearningdocuments } from "src/models/data-models/lessonlearningdocuments";
import { lessonlearnings } from "src/models/data-models/lessonlearnings";
import { lessons } from "src/models/data-models/lessons";
import { lessonplans } from "src/models/data-models/lessonplan";
import { curriculums } from "src/models/data-models/curriculums";
import { grades } from "src/models/data-models/grades";
import { levels } from "src/models/data-models/levels";
import { students } from "src/models/data-models/students";
import { studentlearningprogress } from "src/models/data-models/studentlearningprogress";
import { Token } from "src/models/token.model";
import { canAccessContent } from "./content-access";
import { LessonBusiness } from "./lesson.business";
import { initModels } from "src/models/data-models/init-models";
import { dbinstance } from "src/services/dbservice";

/**
 * Learning items on the read side: `GET /lesson/learning/:id` (LessonBusiness.getlearninglesson) returns the
 * item's type, body and the documents its link rows name, each with a file object built as for `documentid`;
 * `GET /lesson/:lessonid/learning` (getlessonbricks) lists each learning's type; a document used only through a
 * link row is content of that learning's curriculum.
 *
 * The models are an in-memory fake (equality and `Op.in` on the columns the code reads).
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ORG_X = "a1000000-0000-4000-8000-00000000000a";
const ORG_Y = "b2000000-0000-4000-8000-00000000000b";
const SCHOOL_X = "a1000000-0000-4000-8000-0000000000a1";

let db: Record<string, Row[]>;
let reads: Array<{ model: string; options: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

const matches = (row: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([key, cond]) => {
    const inList = cond && typeof cond === "object" ? (cond as Record<symbol, unknown[]>)[Op.in as unknown as symbol] : undefined;
    return inList ? inList.includes(row[key]) : row[key] === cond;
  });

const MODELS: Array<[string, any]> = [ // eslint-disable-line @typescript-eslint/no-explicit-any
  ["lessonlearnings", lessonlearnings],
  ["lessonlearningdocuments", lessonlearningdocuments],
  ["documents", documents],
  ["lessons", lessons],
  ["lessonplans", lessonplans],
  ["levels", levels],
  ["grades", grades],
  ["curriculums", curriculums],
  ["students", students],
  ["studentlearningprogress", studentlearningprogress],
];

const wrap = (row: Row, options: any): Row => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (options?.raw) return { ...row };
  const copy: Row = { ...row };
  Object.defineProperty(copy, "setDataValue", { value: (k: string, v: unknown) => { copy[k] = v; }, enumerable: false });
  Object.defineProperty(copy, "toJSON", { value: () => ({ ...copy }), enumerable: false });
  return copy;
};

// the associations the business code declares at call time need initialised models (no connection is made)
beforeAll(() => {
  initModels(dbinstance.getdbinstance());
});
afterAll(async () => {
  await dbinstance.getdbinstance().close();
});

const install = (data: Record<string, Row[]>) => {
  db = data;
  reads = [];
  for (const [name, model] of MODELS) {
    db[name] = db[name] ?? [];
    jest.spyOn(model, "scope").mockReturnValue(model as never);
    jest.spyOn(model, "findAll").mockImplementation((async (options: any = {}) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      reads.push({ model: name, options });
      let rows = db[name].filter((r) => matches(r, options.where));
      for (const [col, dir] of (options.order ?? []) as Array<[string, string]>) {
        rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === "DESC" ? -1 : 1));
      }
      return rows.map((r) => wrap(r, options));
    }) as never);
    jest.spyOn(model, "findOne").mockImplementation((async (options: any = {}) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      reads.push({ model: name, options });
      const row = db[name].find((r) => matches(r, options.where));
      return row ? wrap(row, options) : null;
    }) as never);
  }
};
afterEach(() => jest.restoreAllMocks());

const learner = { schooluserid: "su-x", studentid: "st-x", schoolid: SCHOOL_X, organisationid: ORG_X } as Token;

const base = (): Record<string, Row[]> => ({
  lessonlearnings: [
    { lessonlearningid: "ll-1", lessonid: "lesson-1", documentid: "doc-main", lessonlearningtype: "video", lessonlearningbody: null, lessonlearningorder: 1 },
    { lessonlearningid: "ll-empty", lessonid: "lesson-1", documentid: null, lessonlearningtype: "video", lessonlearningbody: null, lessonlearningorder: 2 },
  ],
  documents: [
    { documentid: "doc-main", documentname: "intro.mp4", organisationid: ORG_X },
    { documentid: "doc-b", documentname: "captions.mp3", organisationid: ORG_X },
    { documentid: "doc-a", documentname: "poster.png", organisationid: ORG_X },
    { documentid: "doc-foreign", documentname: "secret.mp4", organisationid: ORG_Y },
  ],
  lessonlearningdocuments: [
    { lessonlearningdocumentid: "lld-2", lessonlearningid: "ll-1", documentid: "doc-b", lessonlearningdocumentrole: "asset", lessonlearningdocumentorder: 2 },
    { lessonlearningdocumentid: "lld-1", lessonlearningid: "ll-1", documentid: "doc-a", lessonlearningdocumentrole: "rendition", lessonlearningdocumentorder: 1 },
  ],
});

describe("GET /lesson/learning/:id: getlearninglesson", () => {
  it("returns the type, the body, the primary file object, and the linked documents in their order, each with a file object", async () => {
    install(base());
    const item = (await new LessonBusiness().getlearninglesson("ll-1", learner)) as unknown as Row;
    expect(item.lessonlearningtype).toBe("video");
    expect(item.lessonlearningbody).toBeNull();
    expect(item.lessonlearningfileobject).toMatchObject({ filename: "intro.mp4", fileext: "mp4", filetype: 2 });
    expect(item.documents).toEqual([
      { documentid: "doc-a", lessonlearningdocumentrole: "rendition", lessonlearningdocumentorder: 1, lessonlearningfileobject: expect.objectContaining({ filename: "poster.png", fileext: "png" }) },
      { documentid: "doc-b", lessonlearningdocumentrole: "asset", lessonlearningdocumentorder: 2, lessonlearningfileobject: expect.objectContaining({ filename: "captions.mp3", fileext: "mp3" }) },
    ]);
  });

  it("an item with no link rows has an empty documents list", async () => {
    const data = base();
    data.lessonlearningdocuments = [];
    install(data);
    const item = (await new LessonBusiness().getlearninglesson("ll-1", learner)) as unknown as Row;
    expect(item.documents).toEqual([]);
    expect(reads.filter((r) => r.model === "documents")).toHaveLength(1); // only the primary document was looked up
  });

  it("a link row naming another organisation's document is absent from the answer (the document is not the caller's)", async () => {
    const data = base();
    data.lessonlearningdocuments.push({ lessonlearningdocumentid: "lld-3", lessonlearningid: "ll-1", documentid: "doc-foreign", lessonlearningdocumentrole: "asset", lessonlearningdocumentorder: 3 });
    install(data);
    const item = (await new LessonBusiness().getlearninglesson("ll-1", learner)) as unknown as Row;
    expect(item.documents.map((d: Row) => d.documentid)).toEqual(["doc-a", "doc-b"]);
    expect(JSON.stringify(item)).not.toContain("secret.mp4");
  });

  it("a link row whose document is not here is left out, and a token with no organisation sees no linked document at all", async () => {
    const data = base();
    data.lessonlearningdocuments.push({ lessonlearningdocumentid: "lld-4", lessonlearningid: "ll-1", documentid: "doc-gone", lessonlearningdocumentrole: "asset", lessonlearningdocumentorder: 4 });
    install(data);
    const item = (await new LessonBusiness().getlearninglesson("ll-1", learner)) as unknown as Row;
    expect(item.documents.map((d: Row) => d.documentid)).toEqual(["doc-a", "doc-b"]);
    const none = (await new LessonBusiness().getlearninglesson("ll-1", { ...learner, organisationid: null })) as unknown as Row;
    expect(none.documents).toEqual([]);
  });

  it("an item with no primary document is returned without a throw: its file object is the same invalid one an unknown document gives", async () => {
    install(base());
    const item = (await new LessonBusiness().getlearninglesson("ll-empty", learner)) as unknown as Row;
    expect(item.documentid).toBeNull();
    expect(reads.filter((r) => r.model === "documents")).toEqual([]); // no lookup of a document by a null id
    expect(item.lessonlearningfileobject).toMatchObject({ filename: "invalid" });
    expect(item.documents).toEqual([]);
  });

  it("an id that is not here is null, as before", async () => {
    install(base());
    await expect(new LessonBusiness().getlearninglesson("nope", learner)).resolves.toBeNull();
  });
});

describe("GET /lesson/:lessonid/learning: getlessonbricks", () => {
  it("asks for each learning's type with its id, name and order", async () => {
    install({ lessons: [{ lessonid: "lesson-1", lessonstatus: true, isdeleted: false }] });
    await new LessonBusiness().getlessonbricks("lesson-1", learner);
    const include = reads.find((r) => r.model === "lessons")!.options.include as Array<Row>;
    const learning = include.find((i) => i.model === lessonlearnings)!;
    expect(learning.attributes).toEqual(["lessonlearningid", "lessonlearningname", "lessonlearningorder", "lessonlearningtype"]);
  });
});

describe("a document used only through a link row", () => {
  const tree = (): Record<string, Row[]> => ({
    ...base(),
    lessons: [{ lessonid: "lesson-1", levelid: "level-1" }],
    levels: [{ levelid: "level-1", gradeid: "grade-1" }],
    grades: [{ gradeid: "grade-1", curriculumid: "cur-1" }],
    curriculums: [{ curriculumid: "cur-1", organisationid: ORG_X }],
    students: [{ studentid: "st-x", curriculumids: ["cur-1"] }],
  });

  it("is content of the learning's curriculum: the organisation's learner reaches it", async () => {
    install(tree());
    await expect(canAccessContent(learner, "document", "doc-b")).resolves.toBe(true);
  });

  it("is not reached by a learner who is not enrolled in that curriculum, nor by another organisation's learner", async () => {
    const data = tree();
    data.students = [{ studentid: "st-x", curriculumids: ["cur-other"] }];
    install(data);
    await expect(canAccessContent(learner, "document", "doc-b")).resolves.toBe(false);
    install(tree());
    await expect(canAccessContent({ ...learner, organisationid: ORG_Y }, "document", "doc-b")).resolves.toBe(false);
  });

  it("is unreachable when no learning uses it, directly or through a link row", async () => {
    install(tree());
    await expect(canAccessContent(learner, "document", "doc-unused")).resolves.toBe(false);
  });
});
