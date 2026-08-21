import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AssistantsController } from "./assistants.controller";
import { AssistantsRepo } from "./assistants.repo";

@Module({
  imports: [AuthModule],
  controllers: [AssistantsController],
  providers: [AssistantsRepo],
  exports: [AssistantsRepo],
})
export class AssistantsModule {}
