import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Auth, CurrentUser } from "../auth/jwt-auth.guard";
import { ProjectGuard, ProjectPermission } from "../projects/project.guard";
import { Permission, type Principal } from "@uni-chat/core";
import { KnowledgeService } from "./knowledge.service";
import { AppError } from "../common/http";

const UrlSchema = z.object({ url: z.string().url().max(2000) });
const TextSchema = z.object({ title: z.string().min(1).max(300), text: z.string().min(1).max(1_000_000) });
const FaqSchema = z.object({ question: z.string().min(1).max(2000), answer: z.string().min(1).max(8000) });
const FaqPatchSchema = z.object({
  question: z.string().min(1).max(2000).optional(),
  answer: z.string().min(1).max(8000).optional(),
  enabled: z.boolean().optional(),
});

@Controller("api/v1/projects/:projectId/knowledge")
@UseGuards(JwtAuthGuard, ProjectGuard)
@ProjectPermission(Permission.ManageProject)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  /** POST .../documents — multipart upload файла (25 МБ, docs/12 §1). */
  @Post("documents")
  @Auth()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024 } }))
  async uploadDocument(
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    @Param("projectId") projectId: string,
    @CurrentUser() user: Principal & { userId: string },
  ) {
    if (!file) throw new BadRequestException("Файл обязателен (поле file)");
    try {
      const doc = await this.knowledge.uploadFile({
        projectId,
        userId: user.userId,
        buffer: file.buffer,
        filename: file.originalname,
        mime: file.mimetype,
      });
      return { document: doc };
    } catch (err) {
      // AppError (NOT_FOUND и пр.) уходит как есть — не маскируем в 422
      if (err instanceof AppError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const code = message.split(":")[0];
      throw new AppError(code === "UNSUPPORTED_TYPE" ? "UNSUPPORTED_TYPE" : "UPLOAD_FAILED", message, 422);
    }
  }

  @Post("urls")
  @Auth()
  async addUrl(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @CurrentUser() user: Principal & { userId: string },
  ) {
    const { url } = UrlSchema.parse(body);
    return { document: await this.knowledge.addUrl({ projectId, userId: user.userId, url }) };
  }

  @Post("texts")
  @Auth()
  async addText(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @CurrentUser() user: Principal & { userId: string },
  ) {
    const input = TextSchema.parse(body);
    return { document: await this.knowledge.addText({ projectId, userId: user.userId, ...input }) };
  }

  @Get("documents")
  @Auth()
  async listDocuments(@Param("projectId") projectId: string) {
    return { documents: await this.knowledge.listDocuments(projectId) };
  }

  @Post("documents/:documentId/reindex")
  @Auth()
  async reindex(@Param("projectId") projectId: string, @Param("documentId") documentId: string) {
    await this.knowledge.reindex(projectId, documentId);
    return { ok: true };
  }

  @Delete("documents/:documentId")
  @Auth()
  async deleteDocument(@Param("projectId") projectId: string, @Param("documentId") documentId: string) {
    await this.knowledge.deleteDocument(projectId, documentId);
    return { ok: true };
  }

  @Post("faqs")
  @Auth()
  async addFaq(@Param("projectId") projectId: string, @Body() body: unknown) {
    const input = FaqSchema.parse(body);
    return { faq: await this.knowledge.addFaq(projectId, input.question, input.answer) };
  }

  @Get("faqs")
  @Auth()
  async listFaqs(@Param("projectId") projectId: string) {
    return { faqs: await this.knowledge.listFaqs(projectId) };
  }

  @Put("faqs/:faqId")
  @Auth()
  async updateFaq(
    @Param("projectId") projectId: string,
    @Param("faqId") faqId: string,
    @Body() body: unknown,
  ) {
    const patch = FaqPatchSchema.parse(body);
    return { faq: await this.knowledge.updateFaq(projectId, faqId, patch) };
  }

  @Delete("faqs/:faqId")
  @Auth()
  async deleteFaq(@Param("projectId") projectId: string, @Param("faqId") faqId: string) {
    await this.knowledge.deleteFaq(projectId, faqId);
    return { ok: true };
  }
}
