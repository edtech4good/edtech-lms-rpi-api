import { Config } from "src/config";
import { initModels } from "src/models/data-models/init-models";
import { dbinstance } from "src/services/dbservice";
import { ProvisionError, USAGE, parseArgs } from "./args";
import { ProvisionPlan, ProvisionResult, Provisioner } from "./provision";

/**
 * `npm run provision -- …` (scripts/provision.js calls this). Prints the plan; with --apply, writes it.
 * Exit status 0 on success, 1 when anything is refused or fails (and then nothing was written).
 * The only place a password is ever printed is the end of a successful --apply, once.
 */

const countOf = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export function describePlan(plan: ProvisionPlan, apply: boolean): string {
  const out: string[] = [];
  // A dry run mints ids that --apply will not reuse (it plans again), so it does not show them.
  const id = (action: string, value: string) => (!apply && action === "create" ? "(new)" : value);
  if (plan.mode === "reset") {
    out.push(apply ? "Resetting a password (--apply): nothing else is changed." : "Password reset plan (dry run: nothing is written; add --apply to write it).");
    out.push(`  database      ${plan.database}`);
    out.push(`  organisation  "${plan.organisation.row.organisationname}"  code ${plan.organisation.row.organisationcode}`);
    out.push(`  school        "${plan.school.schoolname}"`);
    out.push(`  login         new password for ${plan.reset?.username} (its session ends); nothing else is changed`);
    return out.join("\n");
  }
  out.push(apply ? "Provisioning (--apply): writing in one transaction." : "Provisioning plan (dry run: nothing is written; add --apply to write it).");
  out.push(`  database      ${plan.database}`);
  out.push(
    `  organisation  ${plan.organisation.action}  "${plan.organisation.row.organisationname}"  code ${plan.organisation.row.organisationcode}  id ${id(plan.organisation.action, plan.organisation.row.organisationid)}`,
  );
  out.push(
    `  school        ${plan.school.action === "restore" ? "restore (it was deleted)" : plan.school.action}  "${plan.school.schoolname}"  id ${id(plan.school.action, plan.school.schoolid)}  country ${plan.school.countryname ?? "(none)"}`,
  );
  if (plan.country && plan.country.action === "create") {
    out.push(`  country       create  "${plan.country.countryname}" (the server has none of that name and there is no payload to carry one)`);
  }
  if (plan.country && plan.country.action === "revive") {
    out.push(`  country       revive  "${plan.country.countryname}" (it is deleted here; a country is a shared reference row, so it is brought back)`);
  }
  out.push(plan.standard ? `  class         ${plan.standard.action}  "${plan.standard.standardname}"` : "  class         none asked for");
  if (plan.standardsKept > 0) {
    out.push(`  classes       the school's ${plan.standardsKept === 1 ? "1 existing class stays" : `${plan.standardsKept} existing classes stay`} as ${plan.standardsKept === 1 ? "it is" : "they are"}`);
  }
  for (const login of plan.logins) {
    out.push(`  login         ${login.action === "create" ? "create" : "exists (password unchanged)"}  ${login.kind}  ${login.username}`);
  }
  if (plan.otherSchoolsMarkedDeleted > 0) {
    out.push(`  --replace-school: ${countOf(plan.otherSchoolsMarkedDeleted, "other school")} of this organisation will be marked deleted (its logins can no longer sign in). Naming it again brings it back.`);
  }
  if (plan.content) {
    const { summary } = plan.content.rehomed;
    out.push(`  content       ${plan.content.file}`);
    out.push("    re-homed to the local organisation; content ids unchanged:");
    out.push(`      owner rewritten on ${Object.entries(summary.ownersRewritten).map(([k, n]) => `${n} ${k}`).join(", ") || "no rows"}`);
    out.push(`      schools: the payload's ${summary.schoolsInPayload} replaced by the local school (listing its ${countOf(summary.curricula, "curriculum")})`);
    out.push(`      classes: the payload's ${summary.standardsInPayload} dropped; the school keeps its own${plan.standard?.action === "create" ? " and gets the new one" : ""}`);
    out.push(`      baseline school lists rewritten: ${summary.baselineListsRewritten}; country added to the payload: ${summary.countryAdded ? "yes" : "no"}`);
    out.push(`      countries re-homed onto this server's row of the same name: ${summary.countriesRemapped}`);
    const rows = Object.entries(summary.rows).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`);
    out.push(`    rows imported: ${rows.join(", ")}`);
  } else {
    out.push("  content       none (--content not given)");
  }
  if (plan.removals) {
    const r = plan.removals;
    const gone = [
      [r.classes, "class", "classes"],
      [r.questions, "question", "questions"],
      [r.documents, "document", "documents"],
      [r.subjects, "subject", "subjects"],
    ] as const;
    const deleted = gone.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
    const marked = [
      [r.curricula, "curriculum", "curricula"],
      [r.schools, "school", "schools"],
    ] as const;
    const kept = marked.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
    out.push(`    the import will DELETE (this organisation's rows the payload does not have): ${deleted.join(", ") || "nothing"}`);
    out.push(`    the import will mark deleted: ${kept.join(", ") || "nothing"}`);
  }
  return out.join("\n");
}

export function describeResult(result: ProvisionResult): string {
  const out: string[] = [];
  const v = result.verification;
  if (v) {
    out.push(
      `Checked in the same transaction: organisations ${v.organisations}, schools ${v.schools}, classes ${v.standards}, logins ${v.logins}, ` +
        `payload rows checked ${v.payloadRowsChecked}, with another owner or missing ${v.payloadRowsWrongOwner}.`,
    );
  }
  if (result.counts) {
    const written = Object.entries(result.counts)
      .map(([k, c]) => [k, (c as { written?: number }).written ?? 0] as const)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ${n}`);
    out.push(`Import wrote: ${written.join(", ") || "nothing"}.`);
  }
  if (result.credentialsFile) {
    out.push(`New passwords were written to ${result.credentialsFile} (readable by you only). They are not shown here and cannot be shown again.`);
  } else if (result.newLogins && result.newLogins.length > 0) {
    out.push("");
    out.push("=== PASSWORDS: shown this ONCE. They are not stored anywhere and cannot be recovered. Write them down now. ===");
    for (const login of result.newLogins) {
      out.push(`  ${(login.kind === "reset" ? "new" : login.kind).padEnd(8)} ${login.username}   ${login.password}`);
    }
    out.push("=======================================================================================================");
  } else {
    out.push("No login was created, so no password is shown (existing logins keep theirs).");
  }
  return out.join("\n");
}

export async function main(argv: string[]): Promise<number> {
  let writing = false;
  try {
    if (argv.includes("--help") || argv.includes("-h")) {
      console.log(USAGE);
      return 0;
    }
    const options = parseArgs(argv);
    // Sequelize prints every statement by default; an INSERT of a login would print its password hash.
    (dbinstance.getdbinstance() as unknown as { options: { logging: unknown } }).options.logging = false;
    initModels(dbinstance.getdbinstance());
    const provisioner = new Provisioner({
      offline: Boolean(Config.fortyk.api.rpi.offline),
      configuredDatabase: Config.fortyk.api.rpi.database.name,
    });
    const plan = await provisioner.plan(options);
    console.log(describePlan(plan, options.apply));
    if (!options.apply) {
      return 0;
    }
    writing = true;
    const result = await provisioner.apply(plan, options);
    console.log(describeResult(result));
    return 0;
  } catch (e) {
    if (e instanceof ProvisionError) {
      console.error(`Refused: ${e.message}\nNothing was written.`);
    } else {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`Failed: ${message}\n${writing ? "The transaction was rolled back; nothing was written." : "Nothing was written (this was a dry run, or it failed before writing)."}`);
    }
    return 1;
  } finally {
    try {
      await dbinstance.getdbinstance().close();
    } catch {
      // nothing to close
    }
  }
}
