import { Module } from "@nestjs/common";
import { AssistantsController } from "./assistants.controller";
import { AssistantsRepo } from "./assistants.repo";

@Module({
  controllers: [AssistantsController],
  providers: [AssistantsRepo],
})
export class AssistantsModule {}
