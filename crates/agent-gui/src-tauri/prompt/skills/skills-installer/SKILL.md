---
name: skills-installer
description: Install, list enabled, validate, or package LiveAgent skills. Use when you need to inspect the skills enabled in the current conversation, import a local skill directory or package, search/install from ClawHub, install from a GitHub repo/tree URL, or reconcile conflicts during an upgrade.
---

# Skills Installer

Install LiveAgent skills into the fixed runtime root while preserving existing user data.

## Workflow

1. Determine the source type: ClawHub slug/search result, local skill directory, `.zip` or `.skill` archive, HTTP(S) download, or GitHub URL.
2. Determine the target root. It is always the fixed user skills root exposed to file tools as `root="skills"`.
3. For local workspace sources, pass workspace-relative paths such as `./my-skill` or `./dist/my-skill.skill`; LiveAgent resolves them against the current chat workspace before installing into the fixed skills root.
4. Read `references/install-sources.md` and `references/safety-and-conflicts.md` through file tools with `root="skills"` and paths prefixed by this skill's `baseDir` before replacing anything.
5. Use `SkillsManager` with `action=list` to inspect the skills enabled in the current conversation when conflict or inventory context matters.
6. Use `SkillsManager` with `action=clawhub_search` to find ClawHub skills when the user asks to search the public store, then use `action=clawhub_install` with the returned `slug` to install from ClawHub.
7. Use `SkillsManager` with `action=install` to import a direct local, archive, HTTP(S), or GitHub source. Prefer `conflict=backup` unless the user explicitly accepts replacement.
8. After installation, the new skill is enabled for the current conversation automatically; ask LiveAgent to rescan skills or reopen the Skills menu only if the new skill does not appear immediately.

## Commands

```bash
SkillsManager(action=list)
SkillsManager(action=clawhub_search, query=memory, limit=10)
SkillsManager(action=clawhub_search, sort=downloads, limit=10)
SkillsManager(action=clawhub_install, slug=example-skill, conflict=backup)
SkillsManager(action=install, source=./my-skill)
SkillsManager(action=install, source=./dist/my-skill.skill)
SkillsManager(action=install, source=https://github.com/owner/repo/tree/main/skills/my-skill)
SkillsManager(action=validate, name=my-skill)
SkillsManager(action=package, name=my-skill)
```

## Rules

- Do not install into the runtime skills root unless the user asked for runtime activation.
- Do not delete backups automatically.
- Treat a source as valid when it contains `SKILL.md`, `skill.md`, `skill.json`, or a fallback `README.md`.
- When inspecting or maintaining enabled installed skill files, use `Read`, `List`, `Glob`, `Grep`, `Write`, `Edit`, or `Delete` with `root="skills"` and a path relative to the fixed Skills root. Never expand the Skills root into an absolute local path.
- Use `conflict=fail` for dry safety checks, `conflict=backup` for upgrades, and `conflict=overwrite` only when the user explicitly accepts data replacement.
