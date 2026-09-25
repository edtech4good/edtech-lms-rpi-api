import { BadRequestException } from "@nestjs/common";
import { UploadLimits } from "src/constants/upload-limits";
import { Token } from "src/models/token.model";
import { ImportController } from "./import.controller";

/**
 * Guards #32 (bound import uploads and zip expansion): the decompressed-size
 * check on the single entry read out of an import zip. `entry.header.size`
 * comes from the zip's central directory and is attacker-controlled — a
 * small file can lie and claim a huge size (a zip bomb) — so the guard has
 * to reject on the CLAIMED size before anything calls `getData()` to
 * inflate it.
 *
 * `adm-zip` is mocked here rather than crafting a real oversized zip: the
 * point under test is the controller's own bound-checking logic
 * (assertEntryWithinLimit/openZip), not adm-zip's inflater. A synthetic
 * entry whose `header.size` exceeds the cap exercises exactly the field the
 * hardening reads, without needing a multi-hundred-MB fixture on disk.
 *
 * Multer's `fileSize` option (the compressed-upload cap: 20 MB
 * roster / 200 MB master) is NOT covered here — that limit is enforced by
 * multer/busboy during multipart parsing, before a controller method ever
 * runs, so it needs a real HTTP request to exercise and isn't reachable by
 * calling the controller method directly. Listed as not covered.
 */
jest.mock("adm-zip");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require("adm-zip");

const user = { schooluserid: "u1", schoolusername: "teacher1" } as Token;

/**
 * `getData` throws if it's ever called on an oversized entry: the whole
 * point of reading `header.size` first is to reject before inflating the
 * entry, so a size-cap test that let `getData` run (and just happened to
 * land on some other error later, e.g. a DB call failing) would pass for
 * the wrong reason. See the mutation table in the PR description — an
 * earlier draft of this file did exactly that.
 */
const mockZipWithEntry = (headerSize: number) => {
  (AdmZip as jest.Mock).mockImplementation(() => ({
    getEntries: () => [
      {
        header: { size: headerSize },
        getData: () => {
          throw new Error("getData() must not run before the size check");
        },
      },
    ],
  }));
};

const expectTooLarge = (promise: Promise<unknown>) =>
  expect(promise).rejects.toMatchObject({
    response: { error: true, errormessage: "import too large" },
  });

describe("ImportController zip decompressed-size bound (#32)", () => {
  afterEach(() => {
    (AdmZip as jest.Mock).mockReset();
  });

  it("rejects a students-roster zip whose entry claims more than ROSTER_ZIP_DECOMPRESSED_MAX_BYTES, without inflating it", async () => {
    mockZipWithEntry(UploadLimits.ROSTER_ZIP_DECOMPRESSED_MAX_BYTES + 1);
    const file = { buffer: Buffer.from("not a real zip, mocked below") } as Express.Multer.File;

    await expectTooLarge(new ImportController().studentsimport(file, user));
  });

  it("rejects a teachers-roster zip whose entry claims more than ROSTER_ZIP_DECOMPRESSED_MAX_BYTES, without inflating it", async () => {
    mockZipWithEntry(UploadLimits.ROSTER_ZIP_DECOMPRESSED_MAX_BYTES + 1);
    const file = { buffer: Buffer.from("not a real zip, mocked below") } as Express.Multer.File;

    await expectTooLarge(new ImportController().teachersimport(file, user));
  });

  it("rejects a master-sync zip whose entry claims more than MASTER_ZIP_DECOMPRESSED_MAX_BYTES, without inflating it", async () => {
    mockZipWithEntry(UploadLimits.MASTER_ZIP_DECOMPRESSED_MAX_BYTES + 1);
    const file = { buffer: Buffer.from("not a real zip, mocked below") } as Express.Multer.File;

    await expectTooLarge(new ImportController().completesync(file, user));
  });

  it("rejects when the multipart part is missing entirely (no file), before any zip is opened", async () => {
    await expect(
      new ImportController().studentsimport(
        undefined as unknown as Express.Multer.File,
        user
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(AdmZip).not.toHaveBeenCalled();
  });

  it("rejects a malformed zip (constructor throws) as a 400, not a raw 500", async () => {
    (AdmZip as jest.Mock).mockImplementation(() => {
      throw new Error("not a zip");
    });
    const file = { buffer: Buffer.from("garbage") } as Express.Multer.File;

    await expect(
      new ImportController().studentsimport(file, user)
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
