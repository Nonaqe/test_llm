-- Аудит IR-059 (docs/32): setup first-owner имел TOCTOU — count()>0 затем insert
-- не атомарны, два параллельных запроса создавали двух owner'ов.
-- Гарантия на уровне БД: ровно один владелец установки.

CREATE UNIQUE INDEX users_single_owner_idx ON users ((true)) WHERE installation_role = 'owner';
