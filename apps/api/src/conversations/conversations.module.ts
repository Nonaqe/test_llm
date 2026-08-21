import { Global, Module } from "@nestjs/common";
import { AssistantsModule } from "../assistants/assistants.module";
import { EscalationsModule } from "../escalations/escalations.module";
import { ConversationEngineService } from "./conversation-engine.service";
import { HandoffService } from "./handoff.service";

@Global()
@Module({
  // AssistantsModule — AssistantsRepo для движка; EscalationsModule — правила (docs/14)
  imports: [AssistantsModule, EscalationsModule],
  providers: [ConversationEngineService, HandoffService],
  exports: [ConversationEngineService, HandoffService],
})
export class ConversationsModule {}
