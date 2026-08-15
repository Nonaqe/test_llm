import { Body, Controller, Get, Param, Put, Req } from "@nestjs/common";
import { z } from "zod";
import { canInstallation, Permission, type Principal } from "@uni-chat/core";
import { AppError } from "../common/http";
import { Auth, AuthedRequest, CurrentUser } from "../auth/jwt-auth.guard";
import { EventsRepo } from "../db/repositories";
import { SettingsService } from "./settings.service";

const PutSettingSchema = z.object({
  key: z.string().min(1).max(200).regex(/^[a-z0-9_.:]+$/),
  value: z.unknown(),
  is_secret: z.boolean().default(false),
});

@Controller("settings")
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly events: EventsRepo,
  ) {}

  /** GET /api/v1/settings — секреты маскируются. */
  @Get()
  @Auth()
  async list(@CurrentUser() user: Principal) {
    if (!canInstallation(user, Permission.ManageInstallation)) {
      throw AppError.forbidden("Настройки установки доступны только администраторам");
    }
    return { settings: await this.settings.list() };
  }

  /** PUT /api/v1/settings/:key. */
  @Put(":key")
  @Auth()
  async put(
    @Param("key") key: string,
    @Body() body: unknown,
    @CurrentUser() user: Principal & { userId: string },
    @Req() req: AuthedRequest,
  ) {
    if (!canInstallation(user, Permission.ManageInstallation)) {
      throw AppError.forbidden("Настройки установки доступны только администраторам");
    }
    const input = PutSettingSchema.parse({ ...((body as object) ?? {}), key });
    await this.settings.set(input.key, input.value, input.is_secret);
    await this.events.append({
      actorType: "user",
      actorId: user.userId,
      action: "settings.updated",
      entityType: "setting",
      entityId: input.key,
      payload: { is_secret: input.is_secret },
      ip: req.ip ?? null,
    });
    return { ok: true };
  }
}
