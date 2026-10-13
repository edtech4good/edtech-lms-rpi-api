import { rpiuseraccess } from "src/models/data-models/rpiuseraccess";
import { randomUUID } from "node:crypto";

export class UserAccessBusiness {
  createuseraccesslog = async (userid: string, ipaddress: string, logintime: number) => {
    await rpiuseraccess.update(
      { logouttime: new Date(new Date().toUTCString()), status: 3, timespent: 0 },
      { where: { userid, status: 1 }}
    )
    await rpiuseraccess.create({
      logintime: new Date(logintime),
      userid,
      status: 1,
      timespent: 0,
      ipaddress,
      rpiuseraccessid: randomUUID(),
    });
  };
}
