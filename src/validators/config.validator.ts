import Joi, { ValidationError } from "joi";
export const schema = Joi.object()
  .keys({
    fortyk: Joi.object()
      .keys({
        api: Joi.object()
          .keys({
            serversynckey: Joi.string().required().description("serversynckey"),
            rpi: Joi.object()
              .keys({
                port: Joi.number().required().description("port"),
                debug: Joi.boolean().required().description("debug"),
                accessexpirationminutes: Joi.number()
                  .required()
                  .description("accessexpirationminutes"),
                applicationsecret: Joi.string()
                  .required()
                  .description("applicationsecret"),
                database: Joi.object()
                  .keys({
                    name: Joi.string().required().description("name"),
                    user: Joi.string().required().description("user"),
                    password: Joi.string().required().description("password"),
                    port: Joi.number().required().default(3306).description("port"),
                    host: Joi.alternatives()
                      .try(Joi.string().uri(), Joi.string().ip(), Joi.string())
                      .required()
                      .description("host"),
                  })
                  .unknown(true),
                offline: Joi.boolean().required().description("Offline or Online")
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
