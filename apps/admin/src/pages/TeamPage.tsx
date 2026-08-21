/**
 * /team — команда (docs/22 §6): пользователи установки (GET/POST /users,
 * роли owner/admin) + участники текущего проекта (GET/POST members).
 * GET /users требует ManageInstallation — операторам показываем честный 403.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { describeApiError } from "../format";
import { useT } from "../i18n";
import type { AdminUser, MemberSummary } from "../api/types";
import { api, useAuth } from "../state/auth";
import { useProjectRouteId } from "../components/Layout";
import { ErrorText, Field } from "../components/ui";

export function TeamPage() {
  const { t } = useT();
  const auth = useAuth();
  const projectId = useProjectRouteId();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersForbidden, setUsersForbidden] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);

  // Форма создания пользователя.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"owner" | "admin" | "none">("none");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Форма добавления участника проекта.
  const [memberRef, setMemberRef] = useState("");
  const [projectRole, setProjectRole] = useState<"project_admin" | "operator">("operator");
  const [addingMember, setAddingMember] = useState(false);
  const [addMemberError, setAddMemberError] = useState<string | null>(null);

  const loadUsers = useCallback(async (): Promise<void> => {
    setUsersLoading(true);
    setUsersError(null);
    setUsersForbidden(false);
    try {
      const res = await api.listUsers();
      setUsers(res.users);
    } catch (err) {
      auth.onApiError(err);
      if (err instanceof ApiError && err.status === 403) setUsersForbidden(true);
      else setUsersError(describeApiError(err));
    } finally {
      setUsersLoading(false);
    }
  }, [auth]);

  const loadMembers = useCallback(async (): Promise<void> => {
    if (projectId === null) {
      setMembers([]);
      return;
    }
    setMembersError(null);
    try {
      const res = await api.listMembers(projectId);
      setMembers(res.members);
    } catch (err) {
      auth.onApiError(err);
      if (!(err instanceof ApiError && err.status === 403)) {
        setMembersError(describeApiError(err));
      }
    }
  }, [projectId, auth]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const createUser = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api.createUser({
        email: email.trim(),
        password,
        name: name.trim(),
        installation_role: role === "none" ? null : role,
      });
      setEmail("");
      setPassword("");
      setName("");
      setRole("none");
      await loadUsers();
    } catch (err) {
      auth.onApiError(err);
      setCreateError(describeApiError(err));
    } finally {
      setCreating(false);
    }
  };

  const addMember = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (projectId === null || addingMember) return;
    const ref = memberRef.trim();
    if (ref === "") return;
    setAddingMember(true);
    setAddMemberError(null);
    try {
      const isEmail = ref.includes("@");
      const res = await api.addMember(
        projectId,
        isEmail ? { email: ref, project_role: projectRole } : { user_id: ref, project_role: projectRole },
      );
      setMembers(res.members);
      setMemberRef("");
    } catch (err) {
      auth.onApiError(err);
      setAddMemberError(describeApiError(err));
    } finally {
      setAddingMember(false);
    }
  };

  return (
    <div className="page-card">
      <h2>{t("team.title")}</h2>

      <section className="team-section">
        <div className="page-head">
          <h3>{t("team.users")}</h3>
        </div>
        <ErrorText text={usersError} />
        {usersForbidden && <p className="muted pad">{t("team.forbidden")}</p>}
        {usersLoading && !usersForbidden && <p className="muted pad">{t("common.loading")}</p>}
        {!usersLoading && !usersForbidden && users.length === 0 && (
          <p className="muted pad">{t("team.empty")}</p>
        )}
        {users.length > 0 && (
          <ul className="entity-list">
            {users.map((user) => (
              <li key={user.id} className="entity-card">
                <div className="entity-main">
                  <span className="entity-title">{user.name !== "" ? user.name : user.email}</span>
                  <span className="conv-mid">
                    {user.name !== "" && <span className="chip">{user.email}</span>}
                    {user.installation_role !== null && <span className="chip">{user.installation_role}</span>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {!usersForbidden && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              void createUser(e);
            }}
          >
            <h4>{t("team.createUser")}</h4>
            <div className="form-grid">
              <Field label={t("common.email")}>
                <input type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label={t("common.password")} hint={t("team.passwordHint")}>
                <input
                  type="password"
                  value={password}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label={t("common.name")}>
                <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t("team.role")}>
                <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                  <option value="none">{t("team.role.none")}</option>
                  <option value="admin">{t("team.role.admin")}</option>
                  <option value="owner">{t("team.role.owner")}</option>
                </select>
              </Field>
            </div>
            <ErrorText text={createError} />
            <button className="btn primary" type="submit" disabled={creating}>
              {creating ? t("common.saving") : t("team.createUser")}
            </button>
          </form>
        )}
      </section>

      <section className="team-section">
        <div className="page-head">
          <h3>{t("team.members")}</h3>
        </div>
        <p className="muted small">{t("team.membersHint")}</p>
        {projectId === null && <p className="muted pad">{t("project.none")}</p>}
        <ErrorText text={membersError ?? addMemberError} />

        {projectId !== null && (
          <>
            <ul className="entity-list">
              {members.map((m) => (
                <li key={m.user_id} className="entity-card">
                  <div className="entity-main">
                    <span className="entity-title">{m.name !== "" ? m.name : m.email}</span>
                    <span className="conv-mid">
                      <span className="chip">{m.project_role}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <form
              className="inline-form"
              onSubmit={(e) => {
                void addMember(e);
              }}
            >
              <h4>{t("team.addMember")}</h4>
              <div className="form-grid">
                <Field label={t("team.memberEmailOrId")}>
                  <input value={memberRef} onChange={(e) => setMemberRef(e.target.value)} />
                </Field>
                <Field label={t("team.projectRole")}>
                  <select
                    value={projectRole}
                    onChange={(e) => setProjectRole(e.target.value as typeof projectRole)}
                  >
                    <option value="operator">{t("team.projectRole.operator")}</option>
                    <option value="project_admin">{t("team.projectRole.project_admin")}</option>
                  </select>
                </Field>
              </div>
              <button className="btn primary" type="submit" disabled={addingMember || memberRef.trim() === ""}>
                {addingMember ? t("common.saving") : t("team.addMember")}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
