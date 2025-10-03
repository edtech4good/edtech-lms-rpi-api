import { Config } from "./../config"

module.exports = {
  development: {
    username: Config.fortyk.api.rpi.database.user,
    password: Config.fortyk.api.rpi.database.password,
    database: Config.fortyk.api.rpi.database.name,
    host: Config.fortyk.api.rpi.database.host,
    port: Config.fortyk.api.rpi.database.port,
    dialect: "mysql",
    define: {
      timestamps: false
    },
    logging: false
  },
  test: {
    username: Config.fortyk.api.rpi.database.user,
    password: Config.fortyk.api.rpi.database.password,
    database: Config.fortyk.api.rpi.database.name,
    host: Config.fortyk.api.rpi.database.host,
    port: Config.fortyk.api.rpi.database.port,
    dialect: "mysql",
    define: {
      timestamps: false
    },
    logging: false
  },
  production: {
    username: Config.fortyk.api.rpi.database.user,
    password: Config.fortyk.api.rpi.database.password,
    database: Config.fortyk.api.rpi.database.name,
    host: Config.fortyk.api.rpi.database.host,
    port: Config.fortyk.api.rpi.database.port,
    dialect: "mysql",
    define: {
      timestamps: false
    },
    logging: false
  }
}
