import winston from 'winston';

const AuditLevels: winston.config.AbstractConfigSetLevels = {
  audit: 2,
};

interface AuditLogger extends winston.Logger {
  audit: winston.LeveledLogMethod;
}
export { AuditLogger, AuditLevels };
