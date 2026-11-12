import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";

/**
 * A certificate central issued to one of this server's learners, kept so the learner app can show it offline.
 * Central owns the data: rows are written only by `PUT /import/certificates` (`src/business/certificates-import.ts`),
 * upserted by `certificateid`. A revoked certificate keeps its row (`revokedat` set) and is never shown to the learner.
 * No revoke reason is stored here, ever.
 */
export interface studentcertificatesAttributes {
  certificateid: string;
  shortcode: string;
  studentid: string;
  curriculumid: string;
  scope: string;
  scopeid: string;
  issuedat: Date;
  revokedat?: Date | null;
  snapshot: Record<string, unknown>;
  checkurl?: string | null;
  lastupdated?: Date;
}

export type studentcertificatesPk = "certificateid";
export type studentcertificatesOptionalAttributes = "revokedat" | "checkurl" | "lastupdated";
export type studentcertificatesCreationAttributes = Optional<studentcertificatesAttributes, studentcertificatesOptionalAttributes>;

export class studentcertificates
  extends Model<studentcertificatesAttributes, studentcertificatesCreationAttributes>
  implements studentcertificatesAttributes
{
  certificateid!: string;
  shortcode!: string;
  studentid!: string;
  curriculumid!: string;
  scope!: string;
  scopeid!: string;
  issuedat!: Date;
  revokedat!: Date | null;
  snapshot!: Record<string, unknown>;
  checkurl!: string | null;
  lastupdated!: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof studentcertificates {
    studentcertificates.init(
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
        lastupdated: { type: DataTypes.DATE, defaultValue: Sequelize.Sequelize.literal("CURRENT_TIMESTAMP"), allowNull: true },
      },
      {
        sequelize,
        tableName: "studentcertificates",
        charset: "utf8mb4",
        collate: "utf8mb4_unicode_ci",
        timestamps: false,
        indexes: [
          { name: "PRIMARY", unique: true, using: "BTREE", fields: [{ name: "certificateid" }] },
          { name: "idx_studentcertificates_studentid", using: "BTREE", fields: [{ name: "studentid" }] },
        ],
      },
    );
    return studentcertificates;
  }
}
