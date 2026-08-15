import { Module } from "@nestjs/common";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";
import { ChunksRepo, DocumentsRepo, FaqsRepo } from "./knowledge.repos";

@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService, DocumentsRepo, FaqsRepo, ChunksRepo],
})
export class KnowledgeModule {}
