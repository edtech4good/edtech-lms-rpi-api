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
      rpi: {
        port: parseInt(process.env.RPI_PORT || "3000"),
        debug: process.env.NODE_ENV === 'development',
        database: {
          name: process.env.RPI_DB_NAME || "edtech_lms_rpi",
          user: process.env.RPI_DB_USER || "root",
          password: process.env.RPI_DB_PASSWORD || "password",
          host: process.env.RPI_DB_HOST || "localhost",
          port: parseInt(process.env.RPI_DB_PORT || "3306")
        }
      }
    }
  }
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

