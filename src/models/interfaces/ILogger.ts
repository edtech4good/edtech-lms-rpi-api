
export interface ILogger {
    log(args: any): void;
    info(args: any): void;
    error(args: any): void;
    warn(args: any): void;
    audit(args: any): void;
    debug(args: any): void;
}
