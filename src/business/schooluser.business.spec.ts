import { schoolusers, students } from "../models/data-models/init-models";
import { SchoolUserBusiness } from "./schooluser.business";

/**
 * Guards #20: getschoolusers must never return schooluserpasswordhash. This
 * mocks the Sequelize model layer (no MySQL) and inspects the `attributes`
 * option the business method actually sent to `findAll`, which is where the
 * exclusion lives.
 */
describe("SchoolUserBusiness.getschoolusers", () => {
  let findAllSpy: jest.SpyInstance;
  let hasOneSpy: jest.SpyInstance;
  let belongsToSpy: jest.SpyInstance;

  beforeEach(() => {
    findAllSpy = jest.spyOn(schoolusers, "findAll").mockResolvedValue([] as never);
    hasOneSpy = jest.spyOn(schoolusers, "hasOne").mockImplementation(() => undefined as never);
    belongsToSpy = jest.spyOn(students, "belongsTo").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    findAllSpy.mockRestore();
    hasOneSpy.mockRestore();
    belongsToSpy.mockRestore();
  });

  it("asks Sequelize to exclude schooluserpasswordhash from the result set", async () => {
    await new SchoolUserBusiness().getschoolusers();

    expect(findAllSpy).toHaveBeenCalledTimes(1);
    const options = findAllSpy.mock.calls[0][0];
    expect(options.attributes).toEqual({ exclude: ["schooluserpasswordhash"] });
  });
});
