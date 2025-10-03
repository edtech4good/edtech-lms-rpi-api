/* eslint-disable import/no-duplicates */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable max-classes-per-file */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { address } from 'ip';
import { hostname } from 'os';
import { toBoolean, toNumber } from 'underscore.string';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { format } from "logform"
import WinstonCloudWatch from 'winston-cloudwatch';
import { ElasticsearchTransport } from 'winston-elasticsearch';
import { LoggerType } from './../models/enums/loggertype.enum';
import { LoggerConfig } from '../models/loggerconfig.model';
import { AuditLevels, AuditLogger as al } from '../models/auditlogger.model';
import { Console } from 'winston/lib/winston/transports';

const elasticsearchlogger = (LOGGERCONNECTIONSTRING: string, APPLICATIONNAME: string): any => {
  const clientOpts = {
    node: LOGGERCONNECTIONSTRING,
  };
  return new ElasticsearchTransport({
    clientOpts,
    indexPrefix: `${APPLICATIONNAME}-auditlog`,
    level: 'audit',
    format: format.combine(
      format.json(),
      format.timestamp(),
      format.errors({
        stack: true,
      }),
      format.metadata() /* add this line if you dont have it */
    ),
  });
};

const filelogger = (APPLICATIONNAME: string): any =>
  new DailyRotateFile({
    filename: `logs/${APPLICATIONNAME}-auditlog-%DATE%.log`,
    level: 'audit',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
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
  });

const consolelogger = (): any =>
  new Console({
    level: 'audit',
    format: format.combine(
      format.json(),
      format.timestamp(),
      format.errors({
        stack: true,
      }),
      format.metadata() /* add this line if you dont have it */
    ),
  });


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

const error = (errorMessage: string): string => {
  throw Error(errorMessage);
};

class AuditLoggerInstance {
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
    this.logger = <al>winston.createLogger({
      levels: AuditLevels,
      transports: [loggerconfig],
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

  logger: al;
}
class AuditLogger {
  constructor() {
    throw new Error('Use logger.getlogger()');
  }

  public static getlogger(config: LoggerConfig | null | undefined): al {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLoggerInstance(config);
    }
    return AuditLogger.instance.logger;
  }

  public static clearlogger(): void {
    AuditLogger.instance = null;
  }

  private static instance: AuditLoggerInstance | null;
}

export { AuditLogger };
