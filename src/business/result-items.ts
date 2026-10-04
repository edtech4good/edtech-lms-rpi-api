import { Logger } from "src/config";
import { baselinequestion, lessonpracticequestions, lessonquizquestions, levelquizquestions } from "src/models/data-models/init-models";

/**
 * A result is for ONE practice, quiz, level quiz or baseline, and each of its items answers one of that container's
 * questions. An item that names a question of any other container, or of none, is not part of the result: it is
 * dropped before anything is graded or stored, so a result row never holds an answer to a question that is not
 * the container's own.
 *
 * "The container's questions" are all the rows the container has, whatever their status: an item for a question
 * that has since been switched off (or that has no renderer) is still the container's own and is kept, as it
 * always was; scoring (practicescore.ts, quizscore.ts) decides what counts.
 */
export type ResultContainer = "lessonpractice" | "lessonquiz" | "levelquiz" | "baseline";

const idsOf = (rows: unknown[], key: string): Set<string> =>
  new Set((rows as Array<Record<string, unknown>>).map((r) => r[key]).filter((v): v is string => typeof v === "string"));

/** The ids of every question row the container has (the same ids a result's items carry under `idKey`). */
export async function containerQuestionIds(kind: ResultContainer, containerid: string): Promise<Set<string>> {
  switch (kind) {
    case "lessonpractice":
      return idsOf(await lessonpracticequestions.findAll({ attributes: ["lessonpracticequestionid"], where: { lessonpracticeid: containerid }, raw: true }), "lessonpracticequestionid");
    case "lessonquiz":
      return idsOf(await lessonquizquestions.findAll({ attributes: ["lessonquizquestionid"], where: { lessonquizid: containerid }, raw: true }), "lessonquizquestionid");
    case "levelquiz":
      return idsOf(await levelquizquestions.findAll({ attributes: ["levelquizquestionid"], where: { levelid: containerid }, raw: true }), "levelquizquestionid");
    case "baseline":
      return idsOf(await baselinequestion.findAll({ attributes: ["baselinequestionid"], where: { curriculumbaselineid: containerid }, raw: true }), "baselinequestionid");
  }
}

/**
 * The items that answer one of the container's questions, in their submitted order. The number dropped is counted in
 * one log line (the route and the count, no ids), and nothing else about the result changes.
 */
export async function confineToContainer<T extends object>(
  route: string,
  kind: ResultContainer,
  containerid: string,
  idKey: string,
  items: T[],
): Promise<T[]> {
  const own = await containerQuestionIds(kind, containerid);
  const kept = items.filter((item) => {
    const id = (item as Record<string, unknown>)[idKey];
    return typeof id === "string" && own.has(id);
  });
  if (kept.length !== items.length) {
    Logger.info(`result items outside the container were dropped for ${route}`, { route, submitted: items.length, dropped: items.length - kept.length });
  }
  return kept;
}
