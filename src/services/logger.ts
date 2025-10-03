/* eslint-disable import/no-duplicates */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable max-classes-per-file */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import 'winston-daily-rotate-file';
import DailyRotateFile from 'winston-daily-rotate-file';
import { ElasticsearchTransport } from 'winston-elasticsearch';
import WinstonCloudWatch from 'winston-cloudwatch';
import winston from 'winston';
import { format } from "logform"
import { address } from 'ip';
import { hostname } from 'os';
import { toBoolean, toNumber } from 'underscore.string';
import { LoggerType } from './../models/enums/loggertype.enum';
import { LoggerConfig } from '../models/loggerconfig.model';
import { Console } from 'winston/lib/winston/transports';
import { LOGDIR } from 'src/models/enums/logaccess.enum';
// Log unhandled exceptions to separate file
const debugfilter = format(info => (info.level === 'debug' ? info : false));
const infoFilter = format(info => (info.level === 'info' || info.level === 'warn' ? info : false));
const errorFilter = format(info => (info.level === 'error' ? info : false));
const elasticsearchlogger = (
  LOGGERCONNECTIONSTRING: string,
  APPLICATIONNAME: string
): {
  exceptionHandlers: Array<any>;
  transports: Array<unknown>;
} => {
  const clientOpts = {
    node: LOGGERCONNECTIONSTRING,
  };
  const exceptionHandlers = [
    new ElasticsearchTransport({
      clientOpts,
      indexPrefix: `${APPLICATIONNAME}-exceptionlog`,
      level: 'error',
      handleExceptions: true,
      format: format.combine(
        format.json(),
        format.timestamp(),
        format.errors({
          stack: true,
        }),
        format.metadata() /* add this line if you dont have it */
      ),
    }),
  ];

  // Separate warn/error
  const transports = [
    new ElasticsearchTransport({
      clientOpts,
      indexPrefix: `${APPLICATIONNAME}-infolog`,
      level: 'info',
      handleExceptions: false,
      format: format.combine(
        infoFilter(),
        format.json(),
        format.timestamp(),
        format.errors({
          stack: true,
        }),
        format.metadata() /* add this line if you dont have it */
      ),
    }),
    new ElasticsearchTransport({
      clientOpts,
      indexPrefix: `${APPLICATIONNAME}-debuglog`,
      level: 'debug',
      handleExceptions: false,
      format: format.combine(
        debugfilter(),
        format.json(),
        format.timestamp(),
        format.errors({
          stack: true,
        }),
        format.metadata() /* add this line if you dont have it */
      ),
    }),
    new ElasticsearchTransport({
      clientOpts,
      indexPrefix: `${APPLICATIONNAME}-errorlog`,
      level: 'error',
      handleExceptions: false,
      format: format.combine(
        errorFilter(),
        format.json(),
        format.timestamp(),
        format.errors({
          stack: true,
        }),
        format.metadata() /* add this line if you dont have it */
      ),
    }),
  ];
  return { exceptionHandlers, transports };
};

const cloudwatchlogger = (
  APPLICATIONNAME: string,
  AWSACCESSKEYID: string,
  AWSSECRETKEY: string,
  AWSREGION: string,
): {
  exceptionHandlers: Array<any>;
  transports: Array<unknown>;
} => {
  const loggercommoninfo = {
    logStreamName: `${APPLICATIONNAME}`,
    retentionInDays: 120,
    AWSACCESSKEYID,
    AWSSECRETKEY,
    AWSREGION,
    jsonMessage: true
  };
  const exceptionHandlers = [
    new WinstonCloudWatch({
      ...loggercommoninfo,
      logGroupName: `${APPLICATIONNAME}-exceptionlog`,
      level: 'error',
      name: `${APPLICATIONNAME}-exceptionlog`
    }),
  ];

  // Separate warn/error
  const transports = [
    new WinstonCloudWatch({
      ...loggercommoninfo,
      logGroupName: `${APPLICATIONNAME}-infolog`,
      level: 'info',
      name: `${APPLICATIONNAME}-infolog`
    }),
    new WinstonCloudWatch({
      ...loggercommoninfo,
      logGroupName: `${APPLICATIONNAME}-debuglog`,
      level: 'debug',
      name: `${APPLICATIONNAME}-debuglog`
    }),
    new WinstonCloudWatch({
      ...loggercommoninfo,
      logGroupName: `${APPLICATIONNAME}-errorlog`,
      level: 'error',
      name: `${APPLICATIONNAME}-errorlog`
    }),
  ];
  return { exceptionHandlers, transports };
};

const filelogger = (
  APPLICATIONNAME: string
): {
  exceptionHandlers: Array<any>;
  transports: Array<unknown>;
} => {
  const exceptionHandlers = [
    new DailyRotateFile({
      filename: `logs/${APPLICATIONNAME}-exception-%DATE%.log`,
      level: 'error',
      handleExceptions: true,
      datePattern: 'YYYY-MM-DD',
      // zippedArchive: true,
      maxSize: '20m',
      maxFiles: '1d',
      json: true,
      format: format.combine(
        format.json(),
        format.timestamp(),
        format.errors({
          stack: true,
        }),
        format.metadata() /* add this line if you dont have it */
      ),
      dirname: LOGDIR
    }),
  ];

  // Separate warn/error
  const transports = [
    new DailyRotateFile({
      json: true,
      level: 'info',
      filename: `logs/${APPLICATIONNAME}-info-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      // zippedArchive: true,
      maxSize: '20m',
      maxFiles: '1d',
      handleExceptions: false,
      format: format.combine(
        infoFilter(),
        format.json(),
        format.timestamp(),
        format.errors({
          stack: true,
        }),
        format.metadata() /* add this line if you dont have it */
      ),
      dirname: LOGDIR
    }),
    new DailyRotateFile({
      json: true,
      level: 'debug',
      filename: `logs/${APPLICATIONNAME}-debug-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      // zippedArchive: true,
      maxSize: '20m',
      maxFiles: '1d',
      handleExceptions: false,
      format: format.combine(
        debugfilter(),
        format.json(),
        format.timestamp(),
        format.errors({
          stack: true,
        }),
        format.metadata() /* add this line if you dont have it */
      ),
      dirname: LOGDIR
    }),
    new DailyRotateFile({
      json: true,
      level: 'error',
      filename: `logs/${APPLICATIONNAME}-error-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      // zippedArchive: true,
      maxSize: '20m',
      maxFiles: '1d',
      handleExceptions: false,
      format: format.combine(
        errorFilter(),
        format.json(),
        format.timestamp(),
        format.errors({
          stack: true,
        }),
        format.metadata() /* add this line if you dont have it */
      ),
      dirname: LOGDIR
    }),
  ];
  return { exceptionHandlers, transports };
};

const consolelogger = (
): {
  exceptionHandlers: Array<any>;
  transports: Array<unknown>;
} => {
  const exceptionHandlers = [
    new Console({
      handleExceptions: true,
      format: format.combine(
        format.json(),
        format.timestamp(),
        format.errors({
          stack: true,
        }),
        format.metadata() /* add this line if you dont have it */
      ),
    }),
  ];

  // Separate warn/error
  const transports = [
    new Console({
      format: format.combine(
        infoFilter(),
        format.json(),
        format.timestamp(),
        format.errors({
          stack: true,
        }),
        format.metadata() /* add this line if you dont have it */
      ),
    }),
  ];
  return { exceptionHandlers, transports };
};


const error = (errorMessage: string): string => {
  throw Error(errorMessage);
};
class LoggerInstance {
  constructor(config: LoggerConfig | null | undefined) {
    let localconfig = new LoggerConfig();

    if (!config) {
      localconfig = {
        LOGGERCONNECTIONSTRING: process.env.LOGGERCONNECTIONSTRING,
        SERVERIP: process.env.SERVERIP,
        SERVERNAME: process.env.SERVERNAME,
        APPLICATIONNAME: process.env.APPLICATIONNAME,
        DEBUG: toBoolean(process.env.DEBUG || 'false'),
        LOGGERTYPE: toNumber(process.env.LOGGERTYPE || LoggerType.FILE.toString()),
        AWSACCESSKEYID: process.env.AWSACCESSKEYID,
        AWSSECRETKEY: process.env.AWSSECRETKEY,
        AWSREGION: process.env.AWSREGION
      };
    }
    localconfig = { ...(config as LoggerConfig) };
    const LOGGERCONNECTIONSTRING =
      localconfig.LOGGERCONNECTIONSTRING || (localconfig.LOGGERTYPE !== LoggerType.FILE ? error('Missing LOGGERCONNECTIONSTRING') : '');
    const AWSACCESSKEYID =
      localconfig.AWSACCESSKEYID || (localconfig.LOGGERTYPE === LoggerType.CLOUDWATCH ? error('Missing AWSACCESSKEYID') : '');
    const AWSSECRETKEY =
      localconfig.LOGGERCONNECTIONSTRING || (localconfig.LOGGERTYPE === LoggerType.CLOUDWATCH ? error('Missing AWSSECRETKEY') : '');
    const AWSREGION =
      localconfig.LOGGERCONNECTIONSTRING || (localconfig.LOGGERTYPE === LoggerType.CLOUDWATCH ? error('Missing AWSREGION') : '');
    const SERVERIP = localconfig.SERVERIP || address();
    const SERVERNAME = localconfig.SERVERNAME || hostname();
    const APPLICATIONNAME = localconfig.APPLICATIONNAME || error('Missing APPLICATIONNAME');
    const LOGGERTYPE = localconfig.LOGGERTYPE || error('Missing LOGGERTYPE');
    let loggerconfig: any = {};
    switch (LOGGERTYPE) {
      case LoggerType.ELASTICSEARCH:
        loggerconfig = elasticsearchlogger(LOGGERCONNECTIONSTRING, APPLICATIONNAME);
        break;
      case LoggerType.CLOUDWATCH:
        loggerconfig = cloudwatchlogger(APPLICATIONNAME, AWSACCESSKEYID, AWSSECRETKEY, AWSREGION);
        break;
      case LoggerType.FILE:
        loggerconfig = filelogger(APPLICATIONNAME);
        break;
      case LoggerType.CONSOLE:
      default:
        loggerconfig = consolelogger();
        break;
    }
    if (localconfig.DEBUG) {
      loggerconfig.transports = [
        ...loggerconfig.transports,
        ...[
          new winston.transports.Console({
            level: 'verbose',
            handleExceptions: true,
            format: format.combine(
              format.json(),
              format.timestamp(),
              format.errors({
                stack: true,
              }),
              format.metadata() /* add this line if you dont have it */
            ),
          }),
        ],
      ];
    }

    this.logger = winston.createLogger({
      ...loggerconfig,
      exitOnError: false,
      defaultMeta: {
        application: APPLICATIONNAME,
        hostname: hostname(),
        serveripaddress: SERVERIP,
        serverhostname: SERVERNAME,
        ipaddress: address(),
      },
      format: format.combine(
        format.json(),
        format.timestamp(),
        format.errors({
          stack: true,
        }),
        format.metadata() /* add this line if you dont have it */
      ),
    });
  }

  logger: winston.Logger;
}
class Logger {
  constructor() {
    throw new Error('Use logger.getlogger()');
  }

  public static getlogger(config: LoggerConfig | null | undefined): winston.Logger {
    if (!Logger.instance) {
      Logger.instance = new LoggerInstance(config);
    }
    return Logger.instance.logger;
  }

  public static clearlogger(): void {
    Logger.instance = null;
  }

  private static instance: LoggerInstance | null;
}
export { Logger };
