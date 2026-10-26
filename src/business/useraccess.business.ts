import { Op } from "sequelize";
import { rpiuseraccess } from "src/models/data-models/rpiuseraccess";
import { randomUUID } from "node:crypto";

export class UserAccessBusiness {
  createuseraccesslog = async (userid: string, ipaddress: string, logintime: number) => {
    // The new access row first: if it is refused, the previous session is still open. Then every other
    // open session of the user is closed (the new row is not one of them).
    const rpiuseraccessid = randomUUID();
    await rpiuseraccess.create({
      logintime: new Date(logintime),
      userid,
      status: 1,
      timespent: 0,
      ipaddress,
      rpiuseraccessid,
    });
    await rpiuseraccess.update(
      { logouttime: new Date(new Date().toUTCString()), status: 3, timespent: 0 },
      { where: { userid, status: 1, rpiuseraccessid: { [Op.ne]: rpiuseraccessid } } }
    );
  };
}
