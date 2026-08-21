import { Module } from "@nestjs/common";
import { AssistantsModule } from "../assistants/assistants.module";
import { AuthModule } from "../auth/auth.module";
import { ProjectsController } from "./projects.controller";
import { SitesController } from "./sites.controller";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsRepo } from "./analytics.repo";
import { SandboxController } from "./sandbox.controller";
import { SandboxService } from "./sandbox.service";
import { ProjectGuard } from "./project.guard";

/**
 * Ф5 Admin Panel (backend): проекты, REST сайтов, аналитика проекта,
 * песочница тестового диалога. RetrievalService/AiProviderService приходят
 * из глобальных RagModule/AiModule, SitesRepo/EventsRepo — из глобальных
 * WidgetReposModule/ReposModule.
 */
@Module({
  imports: [AuthModule, AssistantsModule],
  controllers: [ProjectsController, SitesController, AnalyticsController, SandboxController],
  providers: [ProjectGuard, AnalyticsRepo, SandboxService],
})
export class ProjectsModule {}
