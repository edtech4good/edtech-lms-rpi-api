import { DataTypes, literal, QueryInterface, Transaction } from "sequelize";

/**
 * `studentcertificates`: the certificates central issued to this server's learners, as central sends them
 * (`PUT /import/certificates`). Central owns them; this server only keeps a copy so the learner app can show them
 * offline. A certificate is revoked, never deleted by a staff action: `revokedat` is set and the learner app stops
 * showing it. No revoke reason is ever stored here.
 *
 *  - `certificateid`: central's id (primary key), so a later push of the same certificate replaces the row;
 *  - `shortcode` ("XXXX-XXXX"), `studentid`, `curriculumid`, `scope` (level | grade | curriculum), `scopeid`;
 *  - `issuedat`, `revokedat` (null while valid), `snapshot` (JSON, as central's), `checkurl` (null when central has none);
 *  - no foreign keys: a certificate outlives the content it names.
 *
 * Idempotent: a second run finds the table (and its index) and does nothing. Every read goes through this
 * migration's own transaction connection: a read on the pool while the transaction holds the only connection would wait
 * for it forever. `down` drops the table.
 */
const TABLE = "studentcertificates";
const INDEX = "idx_studentcertificates_studentid";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      if (!(await queryInterface.tableExists(TABLE, { transaction } as never))) {
        await queryInterface.createTable(
          TABLE,
          {
            certificateid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
            shortcode: { type: DataTypes.CHAR(9), allowNull: false },
            studentid: { type: DataTypes.STRING(36), allowNull: false },
            curriculumid: { type: DataTypes.STRING(36), allowNull: false },
            scope: { type: DataTypes.STRING(16), allowNull: false },
            scopeid: { type: DataTypes.STRING(36), allowNull: false },
            issuedat: { type: DataTypes.DATE(3), allowNull: false },
            revokedat: { type: DataTypes.DATE(3), allowNull: true },
            snapshot: { type: DataTypes.JSON, allowNull: false },
            checkurl: { type: DataTypes.TEXT, allowNull: true },
            lastupdated: { type: DataTypes.DATE, allowNull: true, defaultValue: literal("CURRENT_TIMESTAMP") },
          },
          { charset: "utf8mb4", collate: "utf8mb4_unicode_ci", transaction },
        );
      }
      const have = new Set(((await queryInterface.showIndex(TABLE, { transaction })) as Array<{ name?: string }>).map((i) => String(i.name)));
      if (!have.has(INDEX)) {
        await queryInterface.addIndex(TABLE, ["studentid"], { name: INDEX, transaction });
      }
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      if (await queryInterface.tableExists(TABLE, { transaction } as never)) {
        await queryInterface.dropTable(TABLE, { transaction });
      }
    }),
};
