import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";
import { ChunksRepo, DocumentsRepo, FaqsRepo } from "./knowledge.repos";

@Module({
  imports: [AuthModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, DocumentsRepo, FaqsRepo, ChunksRepo],
})
export class KnowledgeModule {}
