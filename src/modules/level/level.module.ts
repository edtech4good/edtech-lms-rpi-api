import { Module } from "@nestjs/common";
import { LevelController } from "./level.controller";

@Module({
    controllers: [LevelController]
})
export class LevelModule {}