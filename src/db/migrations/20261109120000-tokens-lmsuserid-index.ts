import { QueryInterface } from "sequelize";

/**
 * Adds a non-unique index on `tokens.lmsuserid`.
 *
 * Sessions are removed by account (`DELETE ... WHERE lmsuserid = ?` at logout and at login, and
 * `lmsuserid IN (...)` when a roster import ends the sessions of accounts it has changed). With no
 * index on the column each of those scans the whole table, which on InnoDB also locks every row it
 * passes until the statement's transaction ends.
 *
 * Skipped when the index is already there; `down` removes it only if it is.
 */
const INDEX_NAME = "tokens_lmsuserid";

const hasIndex = async (queryInterface: QueryInterface): Promise<boolean> => {
  const indexes = (await queryInterface.showIndex("tokens")) as Array<{ name: string }>;
  return indexes.some((i) => i.name === INDEX_NAME);
};

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    if (!(await hasIndex(queryInterface))) {
      await queryInterface.addIndex("tokens", ["lmsuserid"], { name: INDEX_NAME });
    }
  },
  down: async (queryInterface: QueryInterface) => {
    if (await hasIndex(queryInterface)) {
      await queryInterface.removeIndex("tokens", INDEX_NAME);
    }
  },
};
