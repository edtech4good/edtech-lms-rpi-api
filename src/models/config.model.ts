export interface Config {
  fortyk: Fortyk;
}

export interface Fortyk {
  api: API;
}

export interface API {
  serversynckey: string;
  rpi: RPI;
}

export interface RPI {
  port: number;
  debug: boolean;
  accessexpirationminutes: number;
  applicationsecret: string;
  offline: boolean;
  database: DataBase;
}

export interface DataBase {
  name: string;
  user: string;
  password: string;
  host: string;
  port: number;
}
