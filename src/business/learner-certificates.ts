import { DEFAULT_RECOGNITION, RECOGNITION_FIELDS } from "src/constants/recognition";
import { curriculums } from "src/models/data-models/curriculums";
import { schools } from "src/models/data-models/school";
import { studentcertificates } from "src/models/data-models/studentcertificates";
import { Token } from "src/models/token.model";
import {
  CertificateScope,
  EligibilityStatus,
  GradeRow,
  LevelRow,
  Reason,
  learnerEligibility,
  levelsOfScope,
  loadAttempts,
  loadQuizContent,
  quizzesInScope,
} from "./certificate-eligibility";
import type { ContentTranslations } from "./content-translations";
import { schoolIdOf } from "./level-award";
import { resolveTierLabels } from "./tier-labels";

/**
 * `GET student/certificates/overview`: what the learner app's "Certificates" section shows.
 *
 * For each enrolled curriculum (the selection "My progress" and the awards overview share), an item for every tier whose
 * recognition is `certificate`: each live level (level tier), each live grade (grade tier), the curriculum itself
 * (curriculum tier), in content order. A curriculum with no certificate tier is left out.
 *
 *  - an item the learner holds an UNREVOKED certificate for is `issued`, with the certificate's fields (eligibility is
 *    not computed for it); a revoked certificate is invisible here, so the item is judged as if it had never been issued;
 *  - any other item has the eligibility of slice 1 (`certificate-eligibility.ts`, the same rule and the same business
 *    code) computed for this learner alone: `ready`, `not_yet` or `cant_check`, with the reasons and the quiz counts;
 *  - `tierlabel` is the learner's school's singular English label for the item's tier, when the school can be found.
 *
 * Read-only, and a fixed number of queries whatever the number of items: the enrolled tree (shared), the recognition
 * columns, the school, the learner's certificates, the quiz content (lessons, quizzes, two question reads), the learner's
 * attempts, and one translations read per table when translations are asked for.
 */

type Translated = Record<string, Record<string, string>>;

export interface CertificateOverviewItem {
  scope: CertificateScope;
  scopeid: string;
  name: string;
  tierlabel?: string;
  status: "issued" | EligibilityStatus;
  reasons: Array<Reason | { reason: "no_quizzes" }>;
  quizcount: number;
  passedcount: number;
  certificate: { certificateid: string; shortcode: string; issuedat: Date; checkurl: string | null } | null;
  translations?: Translated;
}

export interface CertificateOverviewCurriculum {
  curriculumid: string;
  curriculumname: string;
  items: CertificateOverviewItem[];
  translations?: Translated;
}

export interface CertificatesOverview {
  curricula: CertificateOverviewCurriculum[];
}

/** The enrolled tree, as `StudentBusiness.getenrolledtree` answers it (grades and levels in teaching order). */
export interface EnrolledTree {
  curricula: Array<{ curriculumid: string; curriculumname: string }>;
  activeGrades: Array<{ gradeid: string; curriculumid: string; gradename: string; gradeorder: number }>;
  activeLevels: Array<{ levelid: string; gradeid: string; levelname: string; levelorder: number }>;
}

const lower = (x: unknown): string => String(x ?? "").toLowerCase();

/** The translations of rows that carry a content row's id and name, read in one query (as the awards overview does). */
const translationsFor = async (translations: ContentTranslations, table: "curriculums" | "grades" | "levels", pk: string, field: string, rows: Array<{ id: string; name: string }>): Promise<Translated[]> => {
  const stand: Array<Record<string, unknown>> = rows.map((r) => ({ [pk]: r.id, [field]: r.name }));
  await translations.decorate(table, stand);
  return stand.map((s) => (s.translations as Translated | undefined) ?? {});
};

type Draft = { id: string; name: string; scope: CertificateScope };

export async function certificatesOverview(user: Token, tree: EnrolledTree, translations?: ContentTranslations): Promise<CertificatesOverview> {
  const studentid = user.studentid;
  if (!studentid || tree.curricula.length === 0) {
    return { curricula: [] };
  }

  // 1. the recognition setting of each curriculum (through the scope that selects it)
  const recognitionRows = await curriculums.scope("withRecognition").findAll({
    where: { curriculumid: tree.curricula.map((c) => c.curriculumid) },
    attributes: ["curriculumid", ...RECOGNITION_FIELDS],
  });
  const recognitionOf = new Map(recognitionRows.map((row) => [row.curriculumid, row]));
  const tierSetting = (curriculumid: string, field: (typeof RECOGNITION_FIELDS)[number]): string =>
    (recognitionOf.get(curriculumid)?.[field] as string | undefined) ?? DEFAULT_RECOGNITION[field];

  // 2. the items, in content order (level tier, grade tier, curriculum tier), before any status is known
  const gradeCurriculum = new Map(tree.activeGrades.map((g) => [g.gradeid, g.curriculumid]));
  const gradeOrder = new Map(tree.activeGrades.map((g) => [g.gradeid, Number(g.gradeorder ?? 0)]));
  const drafts = tree.curricula.map((cur) => {
    const grs: GradeRow[] = tree.activeGrades
      .filter((g) => g.curriculumid === cur.curriculumid)
      .map((g) => ({ gradeid: g.gradeid, gradename: g.gradename, gradeorder: g.gradeorder, gradestatus: true, isdeleted: false }));
    const lvs: LevelRow[] = tree.activeLevels
      .filter((l) => gradeCurriculum.get(l.gradeid) === cur.curriculumid)
      .map((l) => ({ levelid: l.levelid, gradeid: l.gradeid, levelname: l.levelname, levelorder: l.levelorder, levelstatus: true, isdeleted: false }))
      // grade order first; the sort is stable, so the tree's level order holds inside a grade
      .sort((a, b) => (gradeOrder.get(a.gradeid) ?? 0) - (gradeOrder.get(b.gradeid) ?? 0));
    const items: Draft[] = [];
    if (tierSetting(cur.curriculumid, "levelrecognition") === "certificate") {
      for (const level of lvs) items.push({ scope: "level", id: level.levelid, name: level.levelname });
    }
    if (tierSetting(cur.curriculumid, "graderecognition") === "certificate") {
      for (const grade of grs) items.push({ scope: "grade", id: grade.gradeid, name: grade.gradename });
    }
    if (tierSetting(cur.curriculumid, "curriculumrecognition") === "certificate") {
      items.push({ scope: "curriculum", id: cur.curriculumid, name: cur.curriculumname });
    }
    return { cur, grs, lvs, items };
  });
  const shown = drafts.filter((d) => d.items.length > 0);
  if (shown.length === 0) {
    return { curricula: [] };
  }

  // 3. the school's tier labels
  const schoolid = await schoolIdOf(user);
  const school = schoolid ? await schools.findOne({ where: { schoolid }, attributes: ["schoolid", "brandingconfig"] }) : null;
  const labels = school ? resolveTierLabels(school.brandingconfig).labelsresolved : undefined;

  // 4. the learner's certificates that are still valid (a revoked one is never read)
  const certificateRows = await studentcertificates.findAll({
    where: { studentid, revokedat: null },
    attributes: ["certificateid", "shortcode", "curriculumid", "scope", "scopeid", "issuedat", "checkurl"],
    order: [["issuedat", "DESC"]],
    raw: true,
  });
  const certificateOf = new Map<string, (typeof certificateRows)[number]>();
  for (const row of certificateRows) {
    const key = `${lower(row.curriculumid)}|${row.scope}|${lower(row.scopeid)}`;
    if (!certificateOf.has(key)) certificateOf.set(key, row); // newest first: the latest valid one wins
  }
  const issuedOf = (curriculumid: string, scope: CertificateScope, scopeid: string) => certificateOf.get(`${lower(curriculumid)}|${scope}|${lower(scopeid)}`);

  // 5. the eligibility of every item with no valid certificate: one read of the content and one of the attempts for all of them
  const pending = shown.flatMap((d) =>
    d.items
      .filter((item) => !issuedOf(d.cur.curriculumid, item.scope, item.id))
      .map((item) => ({ d, item, scopeLevels: levelsOfScope({ curriculumid: d.cur.curriculumid, grades: d.grs, levels: d.lvs }, item.scope, item.id) ?? [] })),
  );
  const levelids = [...new Set(pending.flatMap((p) => p.scopeLevels.map((l) => l.levelid)))];
  const content = pending.length > 0 ? await loadQuizContent(levelids) : undefined;
  const quizzesOf = pending.map((p) =>
    quizzesInScope({ grades: p.d.grs, levels: p.d.lvs, lessons: content!.lessonRows, lessonquizzes: content!.quizRows }, p.scopeLevels, content!.activeLessonQuizIds, content!.levelsWithQuiz),
  );
  const attempts = await loadAttempts([studentid], quizzesOf.flat());
  const eligibilityOf = new Map<string, ReturnType<typeof learnerEligibility>>();
  pending.forEach((p, at) => {
    eligibilityOf.set(
      `${p.d.cur.curriculumid}|${p.item.scope}|${p.item.id}`,
      learnerEligibility(studentid, quizzesOf[at], (quizid) => attempts.get(`${lower(studentid)}|${lower(quizid)}`) ?? []),
    );
  });

  // 6. the answer
  const curricula: CertificateOverviewCurriculum[] = shown.map((d) => ({
    curriculumid: d.cur.curriculumid,
    curriculumname: d.cur.curriculumname,
    items: d.items.map((item): CertificateOverviewItem => {
      const issued = issuedOf(d.cur.curriculumid, item.scope, item.id);
      const tierlabel = labels?.[item.scope].en.one;
      const base = { scope: item.scope, scopeid: item.id, name: item.name, ...(tierlabel ? { tierlabel } : {}) };
      if (issued) {
        return {
          ...base,
          status: "issued",
          reasons: [],
          quizcount: 0,
          passedcount: 0,
          certificate: { certificateid: issued.certificateid, shortcode: issued.shortcode, issuedat: issued.issuedat, checkurl: issued.checkurl ?? null },
        };
      }
      const e = eligibilityOf.get(`${d.cur.curriculumid}|${item.scope}|${item.id}`)!;
      return { ...base, status: e.status, reasons: e.reasons, quizcount: e.quizcount, passedcount: e.passedcount, certificate: null };
    }),
  }));

  // 7. names translated, one query per table for the whole answer (the field names are the content columns', as the awards overview's)
  if (translations) {
    const items = curricula.flatMap((c) => c.items);
    const ofScope = (scope: CertificateScope) => items.filter((i) => i.scope === scope);
    const wholeCurricula = ofScope("curriculum");
    const [cu, lv, gr] = await Promise.all([
      translationsFor(translations, "curriculums", "curriculumid", "curriculumname", [
        ...curricula.map((c) => ({ id: c.curriculumid, name: c.curriculumname })),
        ...wholeCurricula.map((i) => ({ id: i.scopeid, name: i.name })),
      ]),
      translationsFor(translations, "levels", "levelid", "levelname", ofScope("level").map((i) => ({ id: i.scopeid, name: i.name }))),
      translationsFor(translations, "grades", "gradeid", "gradename", ofScope("grade").map((i) => ({ id: i.scopeid, name: i.name }))),
    ]);
    curricula.forEach((c, at) => (c.translations = cu[at]));
    wholeCurricula.forEach((i, at) => (i.translations = cu[curricula.length + at]));
    ofScope("level").forEach((i, at) => (i.translations = lv[at]));
    ofScope("grade").forEach((i, at) => (i.translations = gr[at]));
  }
  return { curricula };
}
