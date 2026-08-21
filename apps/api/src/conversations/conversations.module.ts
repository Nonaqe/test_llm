import { Global, Module } from "@nestjs/common";
import { EscalationsModule } from "../escalations/escalations.module";
import { ConversationEngineService } from "./conversation-engine.service";
import { HandoffService } from "./handoff.service";

@Global()
@Module({
  imports: [EscalationsModule],
  providers: [ConversationEngineService, HandoffService],
  exports: [ConversationEngineService, HandoffService],
})
export class ConversationsModule {}
