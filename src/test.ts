import { documents, initModels } from "./models/data-models/init-models";
import { dbinstance } from "./services/dbservice";
export class TestApp {

  async run() {
    initModels(dbinstance.getdbinstance());
    const cust = await documents.findOne();
    let c = cust?.get({ plain: true })
    console.log(c);

  }
}
