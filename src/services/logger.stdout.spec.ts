import { Logger } from "./logger";
import { LoggerConfig } from "src/models/loggerconfig.model";
import { LoggerType } from "src/models/enums/loggertype.enum";
import { GlobalExceptionFilter } from "src/filters/global-exception.filter";
import { ApiError } from "src/models/ApiError";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { Config, Logger as AppLogger } from "src/config";

/**
 * With debug off (how a deployed server runs) a warning and an error also reach stdout, one line each with the class,
 * the code and the message, so `docker logs` shows what was refused. The stack is on an error (5xx) line only. The
 * file logs and the request log are unchanged, and an error response never carries a stack.
 */
const config = (debug: boolean): LoggerConfig => ({
  APPLICATIONNAME: "RPI-API-STDOUT-SPEC",
  LOGGERTYPE: LoggerType.FILE,
  DEBUG: debug,
  SERVERIP: "127.0.0.1",
  SERVERNAME: "spec",
});

/** The logger is a stream: its transports write a tick later. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

describe("stdout logging with debug off", () => {
  const original = process.env.NODE_ENV;
  let lines: string[];

  beforeEach(() => {
    process.env.NODE_ENV = "production"; // the transport is silent under test, so every other spec stays quiet
    lines = [];
    jest.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    Logger.clearlogger();
  });
  afterEach(() => {
    process.env.NODE_ENV = original;
    Logger.getlogger(config(false)).close();
    Logger.clearlogger();
    jest.restoreAllMocks();
  });

  it("has a console transport for warn and above, and a warning and an error reach it", async () => {
    const logger = Logger.getlogger(config(false));
    const consoles = logger.transports.filter((t) => t.constructor.name === "Console");
    expect(consoles).toHaveLength(1);
    expect(consoles[0].level).toBe("warn");
    logger.warn("Exception", { code: "INVALID_INPUT", status: 400, exception: { class: "RosterRowsError", message: "1 row names a curriculum", stack: "STACKTEXT" } });
    logger.error("Exception", { code: "INTERNAL", status: 500, exception: { class: "TypeError", message: "boom", stack: "Error: boom\n    at somewhere" } });
    logger.info("an ordinary request");
    await settled();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/ warn Exception /);
    expect(lines[0]).toContain('class="RosterRowsError"');
    expect(lines[0]).toContain('code="INVALID_INPUT"');
    expect(lines[0]).toContain("status=400");
    expect(lines[0]).toContain('errormessage="1 row names a curriculum"');
  });

  it("a 4xx line has no stack, a 5xx line has one, and each is a single line", async () => {
    const logger = Logger.getlogger(config(false));
    logger.warn("Exception", { status: 400, exception: { class: "X", message: "m", stack: "STACKTEXT" } });
    logger.error("Exception", { status: 500, exception: { class: "X", message: "m", stack: "Error: m\n    at here" } });
    await settled();
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toContain("STACKTEXT");
    expect(lines[0]).not.toContain("stack=");
    expect(lines[1]).toContain("stack=");
    expect(lines[1]).toContain("at here");
    expect(lines.every((l) => !l.includes("\n"))).toBe(true);
  });

  it("with debug on there is no extra warn console transport (debug has its own verbose one)", () => {
    const logger = Logger.getlogger(config(true));
    const levels = logger.transports.filter((t) => t.constructor.name === "Console").map((t) => t.level);
    expect(levels).toEqual(["verbose"]);
  });

  it("the filter's refusal reaches stdout as one warn line without a stack, and its response has no stack", async () => {
    const logger = Logger.getlogger(config(false));
    const previous = Config.fortyk.api.rpi.debug;
    Config.fortyk.api.rpi.debug = false;
    jest.spyOn(AppLogger, "warn").mockImplementation(((message: string, meta: object) => logger.warn(message, meta)) as never);
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ method: "PUT", route: { path: "/import/students" } }) }) };
    new GlobalExceptionFilter().catch(new ApiError(ErrorCode.INVALID_INPUT, { message: "2 rows name a curriculum this server doesn't have. Nothing was written." }), host as never);
    await settled();
    Config.fortyk.api.rpi.debug = previous;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("status=400");
    expect(lines[0]).toContain("2 rows name a curriculum");
    expect(lines[0]).not.toContain("stack=");
    expect(JSON.stringify(response.json.mock.calls[0][0])).not.toContain("stack");
  });
});
