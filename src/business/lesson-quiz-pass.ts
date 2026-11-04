import { organisations } from "src/models/data-models/organisations";
import { Logger } from "src/config";
import { Token } from "src/models/token.model";
import { requiresLessonQuizPass } from "./progress-rules";

/**
 * The per-organisation rule "a lesson quiz that is not passed earns no points".
 *
 * The setting lives at `organisations.settingsconfig.requireLessonQuizPass` and is read by `requiresLessonQuizPass`
 * (in progress-rules.ts, so an operator script can load it without the app's database layer): only the boolean `true`
 * turns it on.
 */
export { requiresLessonQuizPass };

/**
 * The points a lesson quiz attempt is stored with. With the rule on, an attempt that does not pass
 * earns 0; a passing attempt earns the quiz's full points; with the rule off the points are returned
 * exactly as given (including null or undefined), whatever the outcome.
 */
export const lessonQuizAttemptPoints = <T>(ruleOn: boolean, ispass: boolean, points: T): T | 0 =>
  ruleOn && !ispass ? 0 : points;

/**
 * Whether the learner's organisation has the rule on. The organisation is the one carried by the
 * token (the strategy has already checked it against the learner's school). Any failure to read the
 * setting (no organisation on the token, a missing row, an unreadable value, a database error)
 * answers false: a submission is never refused or broken by this lookup.
 */
export const lessonQuizPassRequired = async (user: Pick<Token, "organisationid">): Promise<boolean> => {
  const organisationid = typeof user?.organisationid === "string" ? user.organisationid.trim() : "";
  if (!organisationid) {
    return false;
  }
  try {
    const organisation = await organisations.findOne({
      attributes: ["organisationid", "settingsconfig"],
      where: { organisationid },
    });
    return requiresLessonQuizPass(organisation?.settingsconfig);
  } catch (err) {
    // Fails towards off, but says so: a rule that silently stops applying must be visible in the log.
    Logger.warn(`lesson quiz pass setting could not be read for organisation <${organisationid}>; the rule is treated as off`, { organisationid, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
};
