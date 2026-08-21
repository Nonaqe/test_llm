import { Module } from "@nestjs/common";
import { MemoryThrottleStore, THROTTLE_STORE } from "../auth/stores";
import { RealtimeModule } from "../realtime/realtime.module";
import { WidgetController } from "./widget.controller";
import { WidgetJsController } from "./widget-js.controller";
import { WidgetService } from "./widget.service";
import { VisitorGuard } from "./visitor.guard";

@Module({
  imports: [RealtimeModule],
  controllers: [WidgetController, WidgetJsController],
  providers: [
    WidgetService,
    VisitorGuard,
    // Отдельный экземпляр throttle для публичной зоны (ключи w-*)
    { provide: THROTTLE_STORE, useClass: MemoryThrottleStore },
  ],
})
export class WidgetModule {}
