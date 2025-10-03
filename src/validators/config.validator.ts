import {
  alternatives,
  boolean,
  number,
  object,
  string,
  ValidationError,
} from "joi";
export const schema = object()
  .keys({
    fortyk: object()
      .keys({
        api: object()
          .keys({
            serversynckey: string().required().description("serversynckey"),
            rpi: object()
              .keys({
                port: number().required().description("port"),
                debug: boolean().required().description("debug"),
                accessexpirationminutes: number()
                  .required()
                  .description("accessexpirationminutes"),
                applicationsecret: string()
                  .required()
                  .description("applicationsecret"),
                database: object()
                  .keys({
                    name: string().required().description("name"),
                    user: string().required().description("user"),
                    password: string().required().description("password"),
                    port: number().required().default(3306).description("port"),
                    host: alternatives()
                      .try(string().uri(), string().ip(), string())
                      .required()
                      .description("host"),
                  })
                  .unknown(true),
                offline: boolean().required().description("Offline or Online")
              })
              .unknown(true),
          })
          .unknown(true),
      })
      .unknown(true),
  })
  .unknown(true);

export const validator = (
  config: any
): Promise<{ error: ValidationError; value: any }> =>
  schema.validateAsync(config, {
    abortEarly: false,
    allowUnknown: true,
  });
