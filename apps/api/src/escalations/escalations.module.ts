import { Module } from "@nestjs/common";
import { AssistantsModule } from "../assistants/assistants.module";
import { EscalationsController } from "./escalations.controller";
import { EscalationsRepo } from "./escalations.repo";

@Module({
  imports: [AssistantsModule],
  controllers: [EscalationsController],
  providers: [EscalationsRepo],
  exports: [EscalationsRepo],
})
export class EscalationsModule {}
