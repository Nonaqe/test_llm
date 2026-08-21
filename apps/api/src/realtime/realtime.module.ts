import { Global, Module } from "@nestjs/common";
import { AdminGateway } from "./admin.gateway";
import { PresenceService } from "./presence.service";
import { WidgetGateway } from "./widget.gateway";

@Global()
@Module({
  providers: [WidgetGateway, AdminGateway, PresenceService],
  exports: [WidgetGateway, AdminGateway, PresenceService],
})
export class RealtimeModule {}
