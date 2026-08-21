import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminGateway } from "./admin.gateway";
import { PresenceService } from "./presence.service";
import { WidgetGateway } from "./widget.gateway";

@Global()
@Module({
  // AuthModule — для UsersPrincipalLoader в AdminGateway (проверка прав подписок)
  imports: [AuthModule],
  providers: [WidgetGateway, AdminGateway, PresenceService],
  exports: [WidgetGateway, AdminGateway, PresenceService],
})
export class RealtimeModule {}
