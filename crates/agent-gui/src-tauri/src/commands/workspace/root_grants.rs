use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[cfg(test)]
use crate::commands::settings::initialize_schema;
use crate::commands::settings::open_db;
use crate::runtime::project_path::project_path_key;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceRootAccess {
    Read,
    Write,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceRootGrantState {
    Active,
    Missing,
    Changed,
}

impl WorkspaceRootAccess {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Write => "write",
        }
    }

    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "read" => Ok(Self::Read),
            "write" => Ok(Self::Write),
            other => Err(format!("不支持的目录权限：{other}")),
        }
    }
}

impl WorkspaceRootGrantState {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Missing => "missing",
            Self::Changed => "changed",
        }
    }
}

/// A modal draft. New grants omit `id`; persisted grants send their existing id
/// so the backend can preserve `createdAt` and reject cross-project id reuse.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRootGrantDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub alias: String,
    pub display_path: String,
    pub access: WorkspaceRootAccess,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRootGrant {
    pub id: String,
    pub project_id: String,
    pub project_path_key: String,
    pub alias: String,
    pub display_path: String,
    pub canonical_path: String,
    pub access: WorkspaceRootAccess,
    pub state: WorkspaceRootGrantState,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug)]
struct ExistingGrant {
    created_at: i64,
    canonical_path: String,
}

#[derive(Clone, Debug)]
struct ValidatedDraft {
    id: Option<String>,
    alias: String,
    display_path: String,
    canonical_path: PathBuf,
    access: WorkspaceRootAccess,
}

fn now_ms() -> i64 {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));
    duration.as_millis() as i64
}

fn validate_project_id(project_id: &str) -> Result<&str, String> {
    let value = project_id.trim();
    if value.is_empty() {
        return Err("projectId 不能为空".to_string());
    }
    if value.len() > 256 {
        return Err("projectId 过长".to_string());
    }
    // Repository/global grants share this table under `scope:` owner ids; a
    // project id must never be able to address them.
    if value.starts_with(SCOPE_OWNER_PREFIX) {
        return Err(format!("projectId 不能以 {SCOPE_OWNER_PREFIX} 开头"));
    }
    Ok(value)
}

fn validate_alias(alias: &str) -> Result<String, String> {
    let value = alias.trim();
    let bytes = value.as_bytes();
    let valid = !bytes.is_empty()
        && bytes.len() <= 32
        && bytes[0].is_ascii_lowercase()
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-' || *byte == b'_'
        });
    if !valid {
        return Err(format!(
            "目录别名“{value}”无效：必须以小写字母开头，且只能包含小写字母、数字、-、_，最长 32 个字符"
        ));
    }
    if matches!(value, "workspace" | "skill" | "uploads" | "external") {
        return Err(format!("目录别名“{value}”是保留名称"));
    }
    Ok(value.to_string())
}

#[cfg(any(windows, test))]
fn is_windows_unc_path(value: &str) -> bool {
    let normalized = value.trim().replace('\\', "/");
    let upper = normalized.to_ascii_uppercase();
    upper.starts_with("//?/UNC/")
        || (normalized.starts_with("//")
            && !normalized.starts_with("//?/")
            && !normalized.starts_with("//./"))
}

fn canonical_directory(value: &str, field_name: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field_name} 不能为空"));
    }
    #[cfg(windows)]
    if is_windows_unc_path(trimmed) {
        return Err(format!("{field_name} 暂不支持 UNC 路径：{trimmed}"));
    }
    let input = Path::new(trimmed);
    if !input.is_absolute() {
        return Err(format!("{field_name} 必须是绝对路径：{trimmed}"));
    }
    let canonical = fs::canonicalize(input)
        .map_err(|error| format!("{field_name} 不存在或无法访问（{trimmed}）：{error}"))?;
    #[cfg(windows)]
    if is_windows_unc_path(&canonical.to_string_lossy()) {
        return Err(format!(
            "{field_name} 解析为暂不支持的 UNC 路径：{}",
            canonical.display()
        ));
    }
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("读取 {field_name} 失败（{}）：{error}", canonical.display()))?;
    if !metadata.is_dir() {
        return Err(format!("{field_name} 不是目录：{}", canonical.display()));
    }
    Ok(canonical)
}

fn paths_overlap(left: &Path, right: &Path) -> bool {
    left.starts_with(right) || right.starts_with(left)
}

fn validate_drafts(
    project_path: &str,
    drafts: Vec<WorkspaceRootGrantDraft>,
) -> Result<(PathBuf, Vec<ValidatedDraft>), String> {
    let primary = canonical_directory(project_path, "项目主目录")?;
    let validated = validate_drafts_against(Some(&primary), drafts)?;
    Ok((primary, validated))
}

/// Global grants have no primary root, so they instead refuse filesystem roots
/// and the home directory: either would turn the allowlist into a blanket grant.
fn reject_overbroad_global_root(canonical_path: &Path) -> Result<(), String> {
    let is_filesystem_root = canonical_path.parent().is_none();
    let is_home = dirs::home_dir()
        .and_then(|home| fs::canonicalize(home).ok())
        .is_some_and(|home| home.starts_with(canonical_path));
    if is_filesystem_root || is_home {
        return Err(format!(
            "全局附加目录不能是磁盘根目录、用户主目录或它们的上级：{}",
            canonical_path.display()
        ));
    }
    Ok(())
}

fn validate_drafts_against(
    primary: Option<&Path>,
    drafts: Vec<WorkspaceRootGrantDraft>,
) -> Result<Vec<ValidatedDraft>, String> {
    let mut aliases = HashSet::new();
    let mut ids = HashSet::new();
    let mut validated: Vec<ValidatedDraft> = Vec::with_capacity(drafts.len());

    for draft in drafts {
        let alias = validate_alias(&draft.alias)?;
        if !aliases.insert(alias.clone()) {
            return Err(format!("目录别名重复：{alias}"));
        }
        if let Some(id) = draft.id.as_deref() {
            let id = id.trim();
            if id.is_empty() || !ids.insert(id.to_string()) {
                return Err("目录授权 id 为空或重复".to_string());
            }
        }

        let display_path = draft.display_path.trim().to_string();
        let canonical_path = canonical_directory(&display_path, "附加目录")?;

        match primary {
            // A child/equal root adds no capability beyond the primary root. A
            // broader read-only reference is useful (for example a monorepo parent)
            // and is the one intentional primary/additional overlap we allow.
            Some(primary) => {
                if canonical_path.starts_with(primary) {
                    return Err(format!(
                        "附加目录不能等于或位于项目主目录内：{}",
                        canonical_path.display()
                    ));
                }
                if primary.starts_with(&canonical_path) && draft.access != WorkspaceRootAccess::Read
                {
                    return Err(format!(
                        "包含项目主目录的附加目录只能设置为只读：{}",
                        canonical_path.display()
                    ));
                }
            }
            None => reject_overbroad_global_root(&canonical_path)?,
        }

        for previous in &validated {
            if paths_overlap(&canonical_path, &previous.canonical_path) {
                return Err(format!(
                    "附加目录不能互相重叠：{} 与 {}",
                    previous.canonical_path.display(),
                    canonical_path.display()
                ));
            }
        }

        validated.push(ValidatedDraft {
            id: draft.id.map(|id| id.trim().to_string()),
            alias,
            display_path,
            canonical_path,
            access: draft.access,
        });
    }
    Ok(validated)
}

fn row_to_grant(row: &rusqlite::Row<'_>) -> rusqlite::Result<(WorkspaceRootGrant, String)> {
    let access_mode: String = row.get(6)?;
    let grant = WorkspaceRootGrant {
        id: row.get(0)?,
        project_id: row.get(1)?,
        project_path_key: row.get(2)?,
        alias: row.get(3)?,
        display_path: row.get(4)?,
        canonical_path: row.get(5)?,
        // Defer the helpful domain error until after rusqlite has decoded the row.
        access: WorkspaceRootAccess::Read,
        state: WorkspaceRootGrantState::Active,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    };
    Ok((grant, access_mode))
}

fn list_with_conn(
    conn: &Connection,
    project_id: &str,
    project_path_key: &str,
) -> Result<Vec<WorkspaceRootGrant>, String> {
    // Callers validate the owner: project commands via `validate_project_id`,
    // scoped commands by constructing a `scope:` owner themselves.
    let mut statement = conn
        .prepare(
            "SELECT grant_id, project_id, project_path_key, alias, display_path, canonical_path, \
                    access_mode, created_at, updated_at \
             FROM workspace_root_grants \
             WHERE project_id = ?1 AND project_path_key = ?2 \
             ORDER BY alias ASC, grant_id ASC",
        )
        .map_err(|error| format!("准备附加目录查询失败：{error}"))?;
    let rows = statement
        .query_map(params![project_id, project_path_key], row_to_grant)
        .map_err(|error| format!("查询附加目录失败：{error}"))?;
    let mut grants = Vec::new();
    for row in rows {
        let (mut grant, access_mode) =
            row.map_err(|error| format!("读取附加目录记录失败：{error}"))?;
        grant.access = WorkspaceRootAccess::parse(&access_mode)?;
        grant.state = match fs::canonicalize(&grant.display_path) {
            Ok(current) if current.to_string_lossy() == grant.canonical_path => {
                WorkspaceRootGrantState::Active
            }
            Ok(_) => WorkspaceRootGrantState::Changed,
            Err(_) => WorkspaceRootGrantState::Missing,
        };
        grants.push(grant);
    }
    Ok(grants)
}

fn load_existing_grants(
    conn: &Connection,
    project_id: &str,
) -> Result<HashMap<String, ExistingGrant>, String> {
    let mut statement = conn
        .prepare(
            "SELECT grant_id, created_at, canonical_path FROM workspace_root_grants WHERE project_id = ?1",
        )
        .map_err(|error| format!("准备现有附加目录查询失败：{error}"))?;
    let rows = statement
        .query_map(params![project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                ExistingGrant {
                    created_at: row.get(1)?,
                    canonical_path: row.get(2)?,
                },
            ))
        })
        .map_err(|error| format!("查询现有附加目录失败：{error}"))?;
    let mut existing = HashMap::new();
    for row in rows {
        let (id, grant) = row.map_err(|error| format!("读取现有附加目录失败：{error}"))?;
        existing.insert(id, grant);
    }
    Ok(existing)
}

fn apply_with_conn(
    conn: &mut Connection,
    project_id: &str,
    project_path: &str,
    drafts: Vec<WorkspaceRootGrantDraft>,
) -> Result<Vec<WorkspaceRootGrant>, String> {
    let project_id = validate_project_id(project_id)?.to_string();
    let (canonical_primary, validated) = validate_drafts(project_path, drafts)?;
    let path_key = project_path_key(&canonical_primary.to_string_lossy());
    save_owner_with_conn(conn, &project_id, &path_key, validated)
}

/// Replaces every grant owned by `owner_id` (a project id or a `scope:` owner).
fn save_owner_with_conn(
    conn: &mut Connection,
    owner_id: &str,
    path_key: &str,
    validated: Vec<ValidatedDraft>,
) -> Result<Vec<WorkspaceRootGrant>, String> {
    let project_id = owner_id.to_string();
    let path_key = path_key.to_string();
    let now = now_ms();

    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("开始保存附加目录事务失败：{error}"))?;
    let existing = load_existing_grants(&transaction, &project_id)?;

    // An id sent by the client must already belong to this project. This keeps
    // a forged/stale modal payload from adopting a grant owned by another project.
    for draft in &validated {
        if let Some(id) = draft.id.as_deref() {
            let Some(existing_grant) = existing.get(id) else {
                return Err(format!("附加目录授权不存在或不属于当前项目：{id}"));
            };
            if draft.canonical_path.to_string_lossy() != existing_grant.canonical_path {
                return Err(format!(
                    "附加目录授权目标已变化，不能隐式重新授权；请移除后重新选择：{}",
                    draft.display_path
                ));
            }
        }
    }

    transaction
        .execute(
            "DELETE FROM workspace_root_grants WHERE project_id = ?1",
            params![project_id],
        )
        .map_err(|error| format!("清理旧附加目录失败：{error}"))?;

    for draft in validated {
        let id = draft.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let created_at = existing.get(&id).map(|item| item.created_at).unwrap_or(now);
        let canonical_path = draft.canonical_path.to_string_lossy().into_owned();
        transaction
            .execute(
                "INSERT INTO workspace_root_grants (\
                    grant_id, project_id, project_path_key, alias, display_path, canonical_path, \
                    access_mode, created_at, updated_at\
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    project_id,
                    path_key,
                    draft.alias,
                    draft.display_path,
                    canonical_path,
                    draft.access.as_str(),
                    created_at,
                    now,
                ],
            )
            .map_err(|error| format!("保存附加目录失败：{error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("提交附加目录事务失败：{error}"))?;

    list_with_conn(conn, &project_id, &path_key)
}

fn revoke_with_conn(conn: &Connection, project_id: &str) -> Result<(), String> {
    let project_id = validate_project_id(project_id)?;
    conn.execute(
        "DELETE FROM workspace_root_grants WHERE project_id = ?1",
        params![project_id],
    )
    .map_err(|error| format!("撤销项目附加目录授权失败：{error}"))?;
    Ok(())
}

fn revoke_many_with_conn(conn: &mut Connection, project_ids: &[String]) -> Result<(), String> {
    let project_ids = project_ids
        .iter()
        .map(|project_id| validate_project_id(project_id).map(str::to_string))
        .collect::<Result<Vec<_>, _>>()?;
    if project_ids.is_empty() {
        return Ok(());
    }

    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("开始批量撤销项目附加目录授权事务失败：{error}"))?;
    for project_id in project_ids {
        transaction
            .execute(
                "DELETE FROM workspace_root_grants WHERE project_id = ?1",
                params![project_id],
            )
            .map_err(|error| format!("撤销项目附加目录授权失败：{error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("提交批量撤销项目附加目录授权事务失败：{error}"))?;
    Ok(())
}

pub(crate) async fn revoke_workspace_root_grants_for_projects(
    project_ids: Vec<String>,
) -> Result<(), String> {
    if project_ids.is_empty() {
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        revoke_many_with_conn(&mut conn, &project_ids)
    })
    .await
    .map_err(|error| format!("workspace root grants batch revoke join 失败：{error}"))?
}

const SCOPE_OWNER_PREFIX: &str = "scope:";
const GLOBAL_SCOPE_OWNER: &str = "scope:global";
const REPOSITORY_SCOPE_OWNER_PREFIX: &str = "scope:repository:";

/// Where a grant lives. Project grants keep their historical project-id owner;
/// repository and global grants reuse the same table under `scope:` owner ids,
/// so no schema migration is needed and the existing UNIQUE constraints apply.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceRootScope {
    Project,
    Repository,
    Global,
}

/// A grant that is in force for one turn, after layering project, repository
/// and global grants on top of the turn's working directory.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedWorkspaceRoot {
    pub id: String,
    pub alias: String,
    pub canonical_path: String,
    pub access: WorkspaceRootAccess,
    pub scope: WorkspaceRootScope,
}

/// Main worktree root of the repository containing `workdir`. Linked worktrees
/// resolve to the same root, which is what lets them share repository grants.
fn repository_root(workdir: &Path) -> Option<PathBuf> {
    for dir in workdir.ancestors() {
        let dot_git = dir.join(".git");
        let Ok(metadata) = fs::metadata(&dot_git) else {
            continue;
        };
        if metadata.is_dir() {
            return fs::canonicalize(dir).ok();
        }
        // Linked worktree: `.git` is a file whose `gitdir:` points at
        // `<common>/.git/worktrees/<name>`, which records `commondir`.
        let text = fs::read_to_string(&dot_git).ok()?;
        let gitdir = dir.join(
            text.lines()
                .find_map(|line| line.strip_prefix("gitdir:"))?
                .trim(),
        );
        let common = match fs::read_to_string(gitdir.join("commondir")) {
            Ok(relative) => gitdir.join(relative.trim()),
            Err(_) => gitdir,
        };
        return fs::canonicalize(common)
            .ok()?
            .parent()
            .map(Path::to_path_buf);
    }
    None
}

struct ScopeOwner {
    owner_id: String,
    path_key: String,
    primary: Option<PathBuf>,
}

fn scope_owner(scope: WorkspaceRootScope, workdir: &str) -> Result<ScopeOwner, String> {
    match scope {
        WorkspaceRootScope::Global => Ok(ScopeOwner {
            owner_id: GLOBAL_SCOPE_OWNER.to_string(),
            path_key: GLOBAL_SCOPE_OWNER.to_string(),
            primary: None,
        }),
        WorkspaceRootScope::Repository => {
            let workdir = canonical_directory(workdir, "工作目录")?;
            let root = repository_root(&workdir)
                .ok_or_else(|| "当前工作目录不在 git 仓库内，无法设置仓库级授权".to_string())?;
            let path_key = project_path_key(&root.to_string_lossy());
            Ok(ScopeOwner {
                owner_id: format!("{REPOSITORY_SCOPE_OWNER_PREFIX}{path_key}"),
                path_key,
                primary: Some(root),
            })
        }
        WorkspaceRootScope::Project => {
            Err("项目级授权请使用 workspace_root_grants_list/apply".to_string())
        }
    }
}

/// Collapses the per-scope grant lists into the roots a turn may use.
///
/// `layers` arrives in precedence order: project, then repository, then global.
/// `workdir` is the turn's canonical primary root, which is always writable.
fn merge_layered_grants(
    workdir: &Path,
    layers: Vec<(WorkspaceRootScope, Vec<WorkspaceRootGrant>)>,
) -> Vec<ResolvedWorkspaceRoot> {
    // First come, first served: a grant is dropped when it is stale, adds nothing
    // beyond the workdir, or collides (same/nested path, same alias) with a grant
    // already accepted from a higher-precedence layer.
    let mut accepted: Vec<ResolvedWorkspaceRoot> = Vec::new();
    for (scope, grants) in layers {
        for grant in grants {
            if grant.state != WorkspaceRootGrantState::Active {
                continue;
            }
            let path = Path::new(&grant.canonical_path);
            if path.starts_with(workdir) {
                continue;
            }
            let collides = accepted.iter().any(|root| {
                root.alias == grant.alias || paths_overlap(path, Path::new(&root.canonical_path))
            });
            if collides {
                continue;
            }
            // A root enclosing the workdir would otherwise make sibling worktrees
            // and the main checkout writable.
            let access = if workdir.starts_with(path) {
                WorkspaceRootAccess::Read
            } else {
                grant.access
            };
            accepted.push(ResolvedWorkspaceRoot {
                id: grant.id,
                alias: grant.alias,
                canonical_path: grant.canonical_path,
                access,
                scope,
            });
        }
    }
    accepted
}

fn resolve_with_conn(
    conn: &Connection,
    workdir: &Path,
    project: Option<(&str, &str)>,
) -> Result<Vec<ResolvedWorkspaceRoot>, String> {
    let mut layers = Vec::new();
    if let Some((project_id, project_path)) = project {
        let primary = canonical_directory(project_path, "项目主目录")?;
        let path_key = project_path_key(&primary.to_string_lossy());
        layers.push((
            WorkspaceRootScope::Project,
            list_with_conn(conn, project_id, &path_key)?,
        ));
    }
    if repository_root(workdir).is_some() {
        let owner = scope_owner(WorkspaceRootScope::Repository, &workdir.to_string_lossy())?;
        layers.push((
            WorkspaceRootScope::Repository,
            list_with_conn(conn, &owner.owner_id, &owner.path_key)?,
        ));
    }
    layers.push((
        WorkspaceRootScope::Global,
        list_with_conn(conn, GLOBAL_SCOPE_OWNER, GLOBAL_SCOPE_OWNER)?,
    ));
    Ok(merge_layered_grants(workdir, layers))
}

/// Directory to grant for a denied tool path: the path itself when it is a
/// directory, otherwise its nearest existing ancestor (a Write may target a
/// file that does not exist yet).
fn grant_directory_for(path: &Path) -> Result<PathBuf, String> {
    for candidate in path.ancestors() {
        if let Ok(metadata) = fs::metadata(candidate) {
            if metadata.is_dir() {
                return canonical_directory(&candidate.to_string_lossy(), "授权目录");
            }
        }
    }
    Err(format!("找不到可授权的目录：{}", path.display()))
}

#[tauri::command]
pub async fn workspace_root_grant_directory(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let input = Path::new(path.trim());
        if !input.is_absolute() {
            return Err(format!("路径必须是绝对路径：{}", path.trim()));
        }
        let directory = grant_directory_for(input)?;
        // Hand back a display path the user would recognise, not the
        // `\\?\`-prefixed canonical form.
        Ok(dunce_display(&directory))
    })
    .await
    .map_err(|error| format!("workspace_root_grant_directory join 失败：{error}"))?
}

fn dunce_display(path: &Path) -> String {
    let text = path.to_string_lossy();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
}

/// Lists repository- or global-scoped grants. `workdir` picks the repository.
#[tauri::command]
pub async fn workspace_root_grants_list_scoped(
    scope: WorkspaceRootScope,
    workdir: String,
) -> Result<Vec<WorkspaceRootGrant>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let owner = scope_owner(scope, &workdir)?;
        let conn = open_db()?;
        list_with_conn(&conn, &owner.owner_id, &owner.path_key)
    })
    .await
    .map_err(|error| format!("workspace_root_grants_list_scoped join 失败：{error}"))?
}

#[tauri::command]
pub async fn workspace_root_grants_apply_scoped(
    scope: WorkspaceRootScope,
    workdir: String,
    grants: Vec<WorkspaceRootGrantDraft>,
) -> Result<Vec<WorkspaceRootGrant>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let owner = scope_owner(scope, &workdir)?;
        let validated = validate_drafts_against(owner.primary.as_deref(), grants)?;
        let mut conn = open_db()?;
        save_owner_with_conn(&mut conn, &owner.owner_id, &owner.path_key, validated)
    })
    .await
    .map_err(|error| format!("workspace_root_grants_apply_scoped join 失败：{error}"))?
}

/// Roots in force for a turn running in `workdir`. The project pair is passed
/// only when the workdir matches a registered project; repository and global
/// grants apply either way.
#[tauri::command]
pub async fn workspace_root_grants_resolve(
    workdir: String,
    project_id: Option<String>,
    project_path: Option<String>,
) -> Result<Vec<ResolvedWorkspaceRoot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workdir = canonical_directory(&workdir, "工作目录")?;
        let project = match (project_id.as_deref(), project_path.as_deref()) {
            (Some(id), Some(path)) => Some((validate_project_id(id)?, path)),
            _ => None,
        };
        let conn = open_db()?;
        resolve_with_conn(&conn, &workdir, project)
    })
    .await
    .map_err(|error| format!("workspace_root_grants_resolve join 失败：{error}"))?
}

#[tauri::command]
pub async fn workspace_root_grants_list(
    project_id: String,
    project_path: String,
) -> Result<Vec<WorkspaceRootGrant>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Keep the list API project-scoped rather than accepting an id alone.
        // This also prevents a missing/stale project entry from silently exposing
        // grants which can no longer be safely evaluated against its primary root.
        let canonical_primary = canonical_directory(&project_path, "项目主目录")?;
        let path_key = project_path_key(&canonical_primary.to_string_lossy());
        let project_id = validate_project_id(&project_id)?;
        let conn = open_db()?;
        list_with_conn(&conn, project_id, &path_key)
    })
    .await
    .map_err(|error| format!("workspace_root_grants_list join 失败：{error}"))?
}

#[tauri::command]
pub async fn workspace_root_grants_apply(
    project_id: String,
    project_path: String,
    grants: Vec<WorkspaceRootGrantDraft>,
) -> Result<Vec<WorkspaceRootGrant>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        apply_with_conn(&mut conn, &project_id, &project_path, grants)
    })
    .await
    .map_err(|error| format!("workspace_root_grants_apply join 失败：{error}"))?
}

#[tauri::command]
pub async fn workspace_root_grants_revoke(project_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Revocation deliberately does not canonicalize the primary path: the
        // project or worktree may already have been removed from disk.
        let conn = open_db()?;
        revoke_with_conn(&conn, &project_id)
    })
    .await
    .map_err(|error| format!("workspace_root_grants_revoke join 失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_connection() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        initialize_schema(&conn).expect("initialize settings schema");
        conn
    }

    fn draft(alias: &str, path: &Path, access: WorkspaceRootAccess) -> WorkspaceRootGrantDraft {
        WorkspaceRootGrantDraft {
            id: None,
            alias: alias.to_string(),
            display_path: path.to_string_lossy().into_owned(),
            access,
        }
    }

    #[test]
    fn apply_persists_canonical_grants_and_preserves_created_at() {
        let temp = TempDir::new().expect("tempdir");
        let primary = temp.path().join("project");
        let reference = temp.path().join("reference");
        fs::create_dir_all(&primary).expect("primary");
        fs::create_dir_all(&reference).expect("reference");
        let mut conn = test_connection();

        let first = apply_with_conn(
            &mut conn,
            "project-1",
            &primary.to_string_lossy(),
            vec![draft("shared", &reference, WorkspaceRootAccess::Read)],
        )
        .expect("first apply");
        assert_eq!(first.len(), 1);
        assert_eq!(
            first[0].canonical_path,
            fs::canonicalize(&reference).unwrap().to_string_lossy()
        );

        let mut update = draft("shared-code", &reference, WorkspaceRootAccess::Write);
        update.id = Some(first[0].id.clone());
        let second = apply_with_conn(
            &mut conn,
            "project-1",
            &primary.to_string_lossy(),
            vec![update],
        )
        .expect("second apply");
        assert_eq!(second[0].id, first[0].id);
        assert_eq!(second[0].created_at, first[0].created_at);
        assert_eq!(second[0].access, WorkspaceRootAccess::Write);
    }

    #[test]
    fn rejects_invalid_alias_missing_directory_and_non_directory() {
        let temp = TempDir::new().expect("tempdir");
        let primary = temp.path().join("project");
        fs::create_dir_all(&primary).expect("primary");
        let file = temp.path().join("file.txt");
        fs::write(&file, "x").expect("file");

        let invalid_alias = validate_drafts(
            &primary.to_string_lossy(),
            vec![draft("Shared Core", temp.path(), WorkspaceRootAccess::Read)],
        )
        .unwrap_err();
        assert!(invalid_alias.contains("目录别名"));

        let missing = temp.path().join("missing");
        assert!(validate_drafts(
            &primary.to_string_lossy(),
            vec![draft("missing", &missing, WorkspaceRootAccess::Read)]
        )
        .unwrap_err()
        .contains("不存在"));

        assert!(validate_drafts(
            &primary.to_string_lossy(),
            vec![draft("file", &file, WorkspaceRootAccess::Read)]
        )
        .unwrap_err()
        .contains("不是目录"));
    }

    fn grant(alias: &str, path: &Path, access: WorkspaceRootAccess) -> WorkspaceRootGrant {
        WorkspaceRootGrant {
            id: alias.to_string(),
            project_id: "p".to_string(),
            project_path_key: "k".to_string(),
            alias: alias.to_string(),
            display_path: path.to_string_lossy().into_owned(),
            canonical_path: path.to_string_lossy().into_owned(),
            access,
            state: WorkspaceRootGrantState::Active,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn merge_prefers_higher_layer_and_drops_conflicts() {
        use WorkspaceRootAccess::{Read, Write};
        let base = Path::new("/r");
        let workdir = base.join("repo/.wt/a");
        let mut stale = grant("stale", &base.join("gone"), Write);
        stale.state = WorkspaceRootGrantState::Missing;
        let merged = merge_layered_grants(
            &workdir,
            vec![
                (
                    WorkspaceRootScope::Project,
                    vec![grant("data", &base.join("data/img"), Write), stale],
                ),
                (
                    WorkspaceRootScope::Repository,
                    vec![
                        grant("repo", &base.join("repo"), Write),
                        grant("inner", &workdir.join("docs"), Write),
                    ],
                ),
                (
                    WorkspaceRootScope::Global,
                    vec![
                        grant("outer", &base.join("data"), Read),
                        grant("data", &base.join("other"), Read),
                        grant("tools", &base.join("tools"), Write),
                    ],
                ),
            ],
        );
        let summary: Vec<_> = merged
            .iter()
            .map(|root| (root.alias.as_str(), root.access, root.scope))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("data", Write, WorkspaceRootScope::Project),
                // Encloses the workdir, so it is forced read-only.
                ("repo", Read, WorkspaceRootScope::Repository),
                ("tools", Write, WorkspaceRootScope::Global),
            ]
        );
    }

    #[test]
    fn repository_root_resolves_linked_worktree_to_main_checkout() {
        let temp = TempDir::new().expect("tempdir");
        let main = temp.path().join("main");
        let admin = main.join(".git/worktrees/wt");
        let worktree = temp.path().join("wt");
        fs::create_dir_all(&admin).expect("admin");
        fs::create_dir_all(worktree.join("src")).expect("worktree");
        fs::write(admin.join("commondir"), "../..\n").expect("commondir");
        fs::write(
            worktree.join(".git"),
            format!("gitdir: {}\n", admin.to_string_lossy()),
        )
        .expect("dot git");

        let expected = fs::canonicalize(&main).unwrap();
        assert_eq!(repository_root(&main), Some(expected.clone()));
        assert_eq!(repository_root(&worktree.join("src")), Some(expected));
    }

    #[test]
    fn repository_grants_resolve_from_linked_worktree_through_db() {
        let temp = TempDir::new().expect("tempdir");
        let main = temp.path().join("main");
        let admin = main.join(".git/worktrees/wt");
        let worktree = temp.path().join("wt");
        let shared = temp.path().join("shared");
        fs::create_dir_all(&admin).expect("admin");
        fs::create_dir_all(&worktree).expect("worktree");
        fs::create_dir_all(&shared).expect("shared");
        fs::write(admin.join("commondir"), "../..\n").expect("commondir");
        fs::write(
            worktree.join(".git"),
            format!("gitdir: {}\n", admin.to_string_lossy()),
        )
        .expect("dot git");
        let mut conn = test_connection();

        let owner = scope_owner(WorkspaceRootScope::Repository, &main.to_string_lossy())
            .expect("repository owner");
        let validated = validate_drafts_against(
            owner.primary.as_deref(),
            vec![draft("shared", &shared, WorkspaceRootAccess::Write)],
        )
        .expect("validate");
        save_owner_with_conn(&mut conn, &owner.owner_id, &owner.path_key, validated)
            .expect("save repository grants");

        let workdir = fs::canonicalize(&worktree).unwrap();
        let resolved = resolve_with_conn(&conn, &workdir, None).expect("resolve");
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].alias, "shared");
        assert_eq!(resolved[0].access, WorkspaceRootAccess::Write);
        assert_eq!(resolved[0].scope, WorkspaceRootScope::Repository);
    }

    #[test]
    fn grant_directory_is_nearest_existing_directory() {
        let temp = TempDir::new().expect("tempdir");
        let dir = temp.path().join("shared");
        fs::create_dir_all(&dir).expect("dir");
        let file = dir.join("notes.txt");
        fs::write(&file, "x").expect("file");
        let expected = fs::canonicalize(&dir).unwrap();

        assert_eq!(grant_directory_for(&dir).unwrap(), expected);
        assert_eq!(grant_directory_for(&file).unwrap(), expected);
        assert_eq!(
            grant_directory_for(&dir.join("new/deeper/file.txt")).unwrap(),
            expected
        );
    }

    #[test]
    fn scope_owner_ids_are_not_addressable_as_projects() {
        assert!(validate_project_id("scope:global").is_err());
    }

    #[test]
    fn global_scope_rejects_home_and_filesystem_root() {
        let home = dirs::home_dir().expect("home");
        assert!(validate_drafts_against(
            None,
            vec![draft("home", &home, WorkspaceRootAccess::Read)]
        )
        .unwrap_err()
        .contains("全局附加目录"));
        let root = fs::canonicalize(&home)
            .unwrap()
            .ancestors()
            .last()
            .unwrap()
            .to_path_buf();
        assert!(validate_drafts_against(
            None,
            vec![draft("root", &root, WorkspaceRootAccess::Read)]
        )
        .is_err());
    }

    #[test]
    fn detects_unc_paths_without_rejecting_verbatim_drive_paths() {
        assert!(is_windows_unc_path(r"\\server\share\project"));
        assert!(is_windows_unc_path("//server/share/project"));
        assert!(is_windows_unc_path(r"\\?\UNC\server\share\project"));
        assert!(!is_windows_unc_path(r"\\?\C:\project"));
        assert!(!is_windows_unc_path(r"C:\project"));
    }

    #[test]
    fn rejects_overlapping_additional_roots() {
        let temp = TempDir::new().expect("tempdir");
        let primary = temp.path().join("project");
        let parent = temp.path().join("external");
        let child = parent.join("child");
        fs::create_dir_all(&primary).expect("primary");
        fs::create_dir_all(&child).expect("child");

        let error = validate_drafts(
            &primary.to_string_lossy(),
            vec![
                draft("parent", &parent, WorkspaceRootAccess::Read),
                draft("child", &child, WorkspaceRootAccess::Read),
            ],
        )
        .unwrap_err();
        assert!(error.contains("不能互相重叠"));
    }

    #[test]
    fn rejects_duplicate_aliases() {
        let temp = TempDir::new().expect("tempdir");
        let primary = temp.path().join("project");
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        fs::create_dir_all(&primary).expect("primary");
        fs::create_dir_all(&first).expect("first");
        fs::create_dir_all(&second).expect("second");

        let error = validate_drafts(
            &primary.to_string_lossy(),
            vec![
                draft("shared", &first, WorkspaceRootAccess::Read),
                draft("shared", &second, WorkspaceRootAccess::Read),
            ],
        )
        .unwrap_err();
        assert!(error.contains("目录别名重复"));
    }

    #[test]
    fn allows_read_only_parent_of_primary_but_rejects_writable_parent() {
        let temp = TempDir::new().expect("tempdir");
        let primary = temp.path().join("monorepo/app");
        fs::create_dir_all(&primary).expect("primary");

        validate_drafts(
            &primary.to_string_lossy(),
            vec![draft("monorepo", temp.path(), WorkspaceRootAccess::Read)],
        )
        .expect("read-only parent is allowed");

        let error = validate_drafts(
            &primary.to_string_lossy(),
            vec![draft("monorepo", temp.path(), WorkspaceRootAccess::Write)],
        )
        .unwrap_err();
        assert!(error.contains("只能设置为只读"));
    }

    #[test]
    fn rejects_additional_root_inside_primary() {
        let temp = TempDir::new().expect("tempdir");
        let primary = temp.path().join("project");
        let child = primary.join("src");
        fs::create_dir_all(&child).expect("child");

        let error = validate_drafts(
            &primary.to_string_lossy(),
            vec![draft("src", &child, WorkspaceRootAccess::Read)],
        )
        .unwrap_err();
        assert!(error.contains("项目主目录内"));
    }

    #[test]
    fn apply_is_transactional_and_rejects_foreign_ids() {
        let temp = TempDir::new().expect("tempdir");
        let primary = temp.path().join("project");
        let reference = temp.path().join("reference");
        fs::create_dir_all(&primary).expect("primary");
        fs::create_dir_all(&reference).expect("reference");
        let mut conn = test_connection();
        let saved = apply_with_conn(
            &mut conn,
            "project-1",
            &primary.to_string_lossy(),
            vec![draft("shared", &reference, WorkspaceRootAccess::Read)],
        )
        .expect("initial apply");

        let forged = WorkspaceRootGrantDraft {
            id: Some("not-owned".to_string()),
            alias: "changed".to_string(),
            display_path: reference.to_string_lossy().into_owned(),
            access: WorkspaceRootAccess::Write,
        };
        assert!(apply_with_conn(
            &mut conn,
            "project-1",
            &primary.to_string_lossy(),
            vec![forged]
        )
        .unwrap_err()
        .contains("不存在或不属于"));
        let key = project_path_key(&fs::canonicalize(&primary).unwrap().to_string_lossy());
        assert_eq!(list_with_conn(&conn, "project-1", &key).unwrap(), saved);
        assert!(list_with_conn(&conn, "project-1", "/different-project")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn revoke_removes_grants_without_requiring_the_primary_directory() {
        let temp = TempDir::new().expect("tempdir");
        let primary = temp.path().join("project");
        let reference = temp.path().join("reference");
        fs::create_dir_all(&primary).expect("primary");
        fs::create_dir_all(&reference).expect("reference");
        let mut conn = test_connection();
        let saved = apply_with_conn(
            &mut conn,
            "project-1",
            &primary.to_string_lossy(),
            vec![draft("shared", &reference, WorkspaceRootAccess::Read)],
        )
        .expect("apply");
        let key = saved[0].project_path_key.clone();

        fs::remove_dir(&primary).expect("remove primary");
        revoke_with_conn(&conn, "project-1").expect("revoke");
        assert!(list_with_conn(&conn, "project-1", &key)
            .expect("list revoked")
            .is_empty());
    }

    #[test]
    fn batch_revoke_only_removes_requested_projects() {
        let temp = TempDir::new().expect("tempdir");
        let primary_one = temp.path().join("project-one");
        let primary_two = temp.path().join("project-two");
        let reference_one = temp.path().join("reference-one");
        let reference_two = temp.path().join("reference-two");
        for path in [&primary_one, &primary_two, &reference_one, &reference_two] {
            fs::create_dir_all(path).expect("test directory");
        }
        let mut conn = test_connection();
        let first = apply_with_conn(
            &mut conn,
            "project-1",
            &primary_one.to_string_lossy(),
            vec![draft(
                "shared-one",
                &reference_one,
                WorkspaceRootAccess::Read,
            )],
        )
        .expect("first apply");
        let second = apply_with_conn(
            &mut conn,
            "project-2",
            &primary_two.to_string_lossy(),
            vec![draft(
                "shared-two",
                &reference_two,
                WorkspaceRootAccess::Read,
            )],
        )
        .expect("second apply");

        revoke_many_with_conn(&mut conn, &["project-1".to_string()]).expect("batch revoke");

        assert!(
            list_with_conn(&conn, "project-1", &first[0].project_path_key)
                .expect("list first")
                .is_empty()
        );
        assert_eq!(
            list_with_conn(&conn, "project-2", &second[0].project_path_key).expect("list second"),
            second
        );
    }

    #[cfg(unix)]
    #[test]
    fn list_marks_missing_and_changed_roots_instead_of_regranting_them() {
        use std::os::unix::fs::symlink;

        let temp = TempDir::new().expect("tempdir");
        let primary = temp.path().join("project");
        let reference = temp.path().join("reference");
        let replacement = temp.path().join("replacement");
        fs::create_dir_all(&primary).expect("primary");
        fs::create_dir_all(&reference).expect("reference");
        fs::create_dir_all(&replacement).expect("replacement");
        let mut conn = test_connection();
        let saved = apply_with_conn(
            &mut conn,
            "project-1",
            &primary.to_string_lossy(),
            vec![draft("shared", &reference, WorkspaceRootAccess::Read)],
        )
        .expect("apply");
        let key = saved[0].project_path_key.clone();

        fs::remove_dir(&reference).expect("remove reference");
        let missing = list_with_conn(&conn, "project-1", &key).expect("list missing");
        assert_eq!(missing[0].state, WorkspaceRootGrantState::Missing);

        symlink(&replacement, &reference).expect("replace with symlink");
        let changed = list_with_conn(&conn, "project-1", &key).expect("list changed");
        assert_eq!(changed[0].state, WorkspaceRootGrantState::Changed);

        let mut update = draft("renamed", &reference, WorkspaceRootAccess::Write);
        update.id = Some(saved[0].id.clone());
        let error = apply_with_conn(
            &mut conn,
            "project-1",
            &primary.to_string_lossy(),
            vec![update],
        )
        .expect_err("changed target must require explicit reauthorization");
        assert!(error.contains("不能隐式重新授权"), "{error}");
        let still_changed = list_with_conn(&conn, "project-1", &key).expect("list unchanged grant");
        assert_eq!(still_changed[0].state, WorkspaceRootGrantState::Changed);
        assert_eq!(still_changed[0].canonical_path, saved[0].canonical_path);
    }

    #[test]
    fn grant_serializes_with_frontend_camel_case_fields() {
        let value = serde_json::to_value(WorkspaceRootGrant {
            id: "grant-1".to_string(),
            project_id: "project-1".to_string(),
            project_path_key: "/project".to_string(),
            alias: "shared".to_string(),
            display_path: "/shared".to_string(),
            canonical_path: "/shared".to_string(),
            access: WorkspaceRootAccess::Read,
            state: WorkspaceRootGrantState::Active,
            created_at: 1,
            updated_at: 2,
        })
        .expect("serialize grant");

        assert_eq!(value["projectId"], "project-1");
        assert_eq!(value["projectPathKey"], "/project");
        assert_eq!(value["displayPath"], "/shared");
        assert_eq!(value["canonicalPath"], "/shared");
        assert_eq!(value["access"], "read");
        assert_eq!(value["state"], "active");
        assert_eq!(value["createdAt"], 1);
        assert_eq!(value["updatedAt"], 2);
    }
}
