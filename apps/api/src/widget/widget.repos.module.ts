import { Global, Module } from "@nestjs/common";
import { ConversationsRepo, HandoffsRepo, SitesRepo, VisitorsRepo } from "./widget.repos";

/** Глобальные репозитории widget-зоны (используются сервисом и realtime-шлюзом). */
@Global()
@Module({
  providers: [SitesRepo, VisitorsRepo, ConversationsRepo, HandoffsRepo],
  exports: [SitesRepo, VisitorsRepo, ConversationsRepo, HandoffsRepo],
})
export class WidgetReposModule {}
