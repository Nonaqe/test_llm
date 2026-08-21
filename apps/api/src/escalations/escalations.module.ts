import { Module } from "@nestjs/common";
import { AssistantsModule } from "../assistants/assistants.module";
import { AuthModule } from "../auth/auth.module";
import { EscalationsController } from "./escalations.controller";
import { EscalationsRepo } from "./escalations.repo";

@Module({
  imports: [AssistantsModule, AuthModule],
  controllers: [EscalationsController],
  providers: [EscalationsRepo],
  exports: [EscalationsRepo],
})
export class EscalationsModule {}
