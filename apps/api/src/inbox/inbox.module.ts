import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";
import { InboxRepo } from "./inbox.repos";

/** Панель оператора: очередь handoff, диалоги, действия (docs/13). */
@Module({
  imports: [AuthModule],
  controllers: [InboxController],
  providers: [InboxService, InboxRepo],
})
export class InboxModule {}
