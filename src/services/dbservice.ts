import { Sequelize } from "sequelize";
import { Config } from "./../config"
export class dbinstance {
    constructor() {
        throw new Error('Use dbinstance.getdbinstance()');
    }
    private static sequelize: Sequelize;

    static getdbinstance() {
        if (!dbinstance.sequelize) {
            this.sequelize = new Sequelize(Config.fortyk.api.rpi.database.name,
                Config.fortyk.api.rpi.database.user,
                Config.fortyk.api.rpi.database.password, {
                host: Config.fortyk.api.rpi.database.host,
                dialect: 'mysql',
                port: Config.fortyk.api.rpi.database.port || 3306,
                // Database statements are printed only when DB_LOG_SQL=1 (development).
                logging: process.env.DB_LOG_SQL === '1' ? console.log : false
            });
        }
        return this.sequelize;
    }
}