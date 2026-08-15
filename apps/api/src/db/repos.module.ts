import { Global, Module } from "@nestjs/common";
import { DbModule } from "./db.module";
import { EventsRepo, ProjectsRepo, SettingsRepo, UsersRepo } from "./repositories";

/** Глобальные SQL-репозитории (один экземпляр на процесс). */
@Global()
@Module({
  imports: [DbModule],
  providers: [UsersRepo, ProjectsRepo, SettingsRepo, EventsRepo],
  exports: [UsersRepo, ProjectsRepo, SettingsRepo, EventsRepo],
})
export class ReposModule {}
