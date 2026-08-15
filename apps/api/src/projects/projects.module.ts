import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProjectsController } from "./projects.controller";
import { ProjectGuard } from "./project.guard";

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController],
  providers: [ProjectGuard],
})
export class ProjectsModule {}
