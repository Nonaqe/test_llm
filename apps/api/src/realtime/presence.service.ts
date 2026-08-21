/**
 * Presence операторов (docs/13 §5): online/away/offline по heartbeat.
 * MVP — in-memory с TTL (Redis-совместимый интерфейс; Redis — Фаза 7, см. D-4).
 */
import { Injectable } from "@nestjs/common";

const DEFAULT_TTL_S = 60;

@Injectable()
export class PresenceService {
  /** projectId → (userId → expiresAt epoch ms) */
  private readonly online = new Map<string, Map<string, number>>();

  heartbeat(projectId: string, userId: string, ttlS = DEFAULT_TTL_S): void {
    let users = this.online.get(projectId);
    if (!users) {
      users = new Map();
      this.online.set(projectId, users);
    }
    users.set(userId, Date.now() + ttlS * 1000);
  }

  removeUser(projectId: string, userId: string): void {
    this.online.get(projectId)?.delete(userId);
  }

  /** Число операторов онлайн (просроченные записи удаляются лениво). */
  onlineCount(projectId: string): number {
    const users = this.online.get(projectId);
    if (!users) return 0;
    const now = Date.now();
    for (const [userId, expiresAt] of users) {
      if (expiresAt <= now) users.delete(userId);
    }
    return users.size;
  }

  isOnline(projectId: string): boolean {
    return this.onlineCount(projectId) > 0;
  }
}
