import { Global, Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { AiProviderService } from "./ai-provider.service";

@Global()
@Module({
  // SettingsModule — SettingsService для чтения ai_provider.* (docs/17)
  imports: [SettingsModule],
  providers: [AiProviderService],
  exports: [AiProviderService],
})
export class AiModule {}
