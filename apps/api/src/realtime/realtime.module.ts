import { Global, Module } from "@nestjs/common";
import { WidgetGateway } from "./widget.gateway";

@Global()
@Module({
  providers: [WidgetGateway],
  exports: [WidgetGateway],
})
export class RealtimeModule {}
