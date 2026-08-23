import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { canInstallation, Permission, type Principal } from "@uni-chat/core";
import { AppError, isUniqueViolation } from "../common/http";
import { Auth, AuthedRequest, CurrentUser, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthService } from "../auth/auth.service";
import { EventsRepo, UsersRepo } from "../db/repositories";

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().max(200).default(""),
  installation_role: z.enum(["owner", "admin"]).nullish(),
});

/** Команда установки (docs/22 §6): создание администраторов/операторов. */
@Controller("api/v1/users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly users: UsersRepo,
    private readonly auth: AuthService,
    private readonly events: EventsRepo,
  ) {}

  @Get()
  @Auth()
  async list(@CurrentUser() user: Principal) {
    if (!canInstallation(user, Permission.ManageInstallation)) {
      throw AppError.forbidden("Команда установки доступна только администраторам");
    }
    const rows = await this.users.listAll();
    return { users: rows };
  }

  @Post()
  @Auth()
  async create(
    @Body() body: unknown,
    @CurrentUser() user: Principal & { userId: string },
    @Req() req: AuthedRequest,
  ) {
    if (!canInstallation(user, Permission.ManageInstallation)) {
      throw AppError.forbidden("Создание пользователей доступно только администраторам");
    }
    const input = CreateUserSchema.parse(body);
    if (input.installation_role === "owner" && user.installationRole !== "owner") {
      throw AppError.forbidden("Только owner может создавать owner");
    }
    const passwordHash = await this.auth.hashPassword(input.password);
    let created;
    try {
      created = await this.users.insert({
        email: input.email,
        passwordHash,
        name: input.name,
        // оператор проекта = без роли установки (docs/06 §3)
        installationRole: input.installation_role ?? null,
      });
    } catch (err) {
      // Дубликат email: PG 23505 → 409 CONFLICT, а не 500 (аудит IR-059)
      if (isUniqueViolation(err)) throw AppError.conflict("EMAIL_TAKEN", "Пользователь с таким email уже существует");
      throw err;
    }
    await this.events.append({
      actorType: "user",
      actorId: user.userId,
      action: "user.created",
      entityType: "user",
      entityId: created.id,
      ip: req.ip ?? null,
    });
    return { user: { id: created.id, email: created.email, name: created.name, installation_role: created.installation_role } };
  }
}
