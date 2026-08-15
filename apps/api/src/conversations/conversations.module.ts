import { Global, Module } from "@nestjs/common";
import { ConversationEngineService } from "./conversation-engine.service";

@Global()
@Module({
  providers: [ConversationEngineService],
  exports: [ConversationEngineService],
})
export class ConversationsModule {}
