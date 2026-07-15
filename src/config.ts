import dotenv from 'dotenv';
import { hostname } from 'os';
import { address } from 'ip';
import winston from 'winston';
import { Config as modelconfig } from './models/config.model';
import { LoggerType } from './models/enums/loggertype.enum';
import { LoggerConfig } from "./models/loggerconfig.model";
import { Logger as internalLogger } from "./services/logger";
import { config as configValidator } from './validators';

dotenv.config();

// Default configuration for development
const defaultConfig = {
  fortyk: {
    api: {
      serversynckey:
        process.env.RPI_SERVER_SYNC_KEY ||
        process.env.SERVER_SYNC_KEY ||
        "local-dev-serversynckey",
      rpi: {
        port: parseInt(process.env.RPI_PORT || "3000", 10),
        debug: process.env.NODE_ENV === "development",
        accessexpirationminutes: parseInt(
          process.env.RPI_ACCESS_EXPIRATION_MINUTES || "60",
          10,
        ),
        applicationsecret:
          process.env.RPI_APPLICATION_SECRET ||
          process.env.JWT_SECRET ||
          process.env.APPLICATION_SECRET ||
          "local-dev-rpi-jwt-secret-change-me",
        offline:
          process.env.RPI_OFFLINE === "true" ||
          process.env.RPI_OFFLINE === "1",
        database: {
          name: process.env.RPI_DB_NAME || "edtech_lms_rpi",
          user: process.env.RPI_DB_USER || "root",
          password: process.env.RPI_DB_PASSWORD || "password",
          host: process.env.RPI_DB_HOST || "localhost",
          port: parseInt(process.env.RPI_DB_PORT || "3306", 10),
        },
      },
    },
  },
};

// Try to parse FORTYKAPIRPICONFIG if provided, otherwise use default config
let configvalues;
try {
  const envConfig = process.env.FORTYKAPIRPICONFIG ? JSON.parse(process.env.FORTYKAPIRPICONFIG) : defaultConfig;
  const { value, error: valerrors } = configValidator.schema.prefs({ errors: { label: 'key' } }).validate(envConfig);
  
  if (valerrors) {
    console.warn(`Config validation warning: ${valerrors.message}. Using default configuration.`);
    configvalues = defaultConfig;
  } else {
    configvalues = value;
  }
} catch (error) {
  console.warn(`Error parsing FORTYKAPIRPICONFIG: ${error.message}. Using default configuration.`);
  configvalues = defaultConfig;
}

const Config: modelconfig = <modelconfig>configvalues;

const buildLogger = (): winston.Logger => {
  const loggerConfig = new LoggerConfig();
  loggerConfig.APPLICATIONNAME = "RPI-API";
  loggerConfig.LOGGERTYPE = LoggerType.FILE;
  loggerConfig.SERVERIP = address();
  loggerConfig.SERVERNAME = hostname();
  loggerConfig.DEBUG = Config.fortyk.api.rpi.debug;
  return internalLogger.getlogger(loggerConfig);
};

const Logger = buildLogger();
export { Logger, Config };

