---
name: mo-pr
description: Save the local Mo_App to GitHub - push the app code, all project files and the command doc to mr-imruu/Mo_App_v.01 as a pull request. Use when the user types /mo-pr or says "mo pr", "Mo pr", "Mo PR", or just "pr" while working on Mo_App.
---

# Mo PR: save app, projects and docs to GitHub

Run every step without asking again; the user already approved this procedure. Never merge the PR or force-push unless the user asks.

Local layout: `~/Documents/Mo_App/Mo_App_v.02` (the app), `~/Documents/Mo_App/Projects` (project JSONs), `~/Documents/Mo_App/Recovered` (the app's autosaves), `~/Documents/Mo_App/Mo_App commands.md` (the command doc).
Repo layout (`mr-imruu/Mo_App_v.01`, base `main`): `Mo_App_v.01/` (the app), `Projects/`, `Fonts/`, `Presets/`, `Claude commands/` (these two commands), `Mo_App commands.md`.

1. Clone `main` fresh into the scratchpad (`gh repo clone mr-imruu/Mo_App_v.01 <dir> -- -q`) and create a branch `mo-pr-<YYYY-MM-DD-HHMM>`.
2. The app folder is now `Mo_App_v.02` locally and in the repo: if the clone still has `Mo_App_v.01/`, run `git rm -r -q Mo_App_v.01` in the clone first (its history stays), and rsync the app to `<dir>/Mo_App_v.02/`.
2a. App code (target `<dir>/Mo_App_v.02/`, not `Mo_App_v.01/`): `rsync -a --delete --exclude node_modules --exclude dist --exclude .git --exclude .toolcraft --exclude .claude/worktrees --exclude .DS_Store --exclude Projects ~/Documents/Mo_App/Mo_App_v.02/ <dir>/Mo_App_v.02/`.
3. Projects: make the repo's `Projects/` an exact copy of `~/Documents/Mo_App/Projects`: `rsync -a --delete --exclude .DS_Store ~/Documents/Mo_App/Projects/ <dir>/Projects/`. Projects deleted locally are deleted in the repo too (they stay in git history); `Recovered` is not pushed.
3a. Newest autosaves: after step 3, for each `~/Documents/Mo_App/Recovered/<name>.json` that is newer than `<dir>/Projects/<name>.json` (by modified time of the local `~/Documents/Mo_App/Projects/<name>.json`) or has no project file yet, copy it to `<dir>/Projects/<name>.json`. Never write into the local `~/Documents/Mo_App/Projects` or `Recovered` folders, only into the clone.
3b. Fonts and presets: `rsync -a --delete --exclude .DS_Store ~/Documents/Mo_App/Fonts/ <dir>/Fonts/` and the same for `~/Documents/Mo_App/Presets/` -> `<dir>/Presets/` (skip a folder that does not exist locally).
4. Doc: copy `~/Documents/Mo_App/Mo_App commands.md` to `<dir>/Mo_App commands.md`.
4b. The commands themselves: `rsync -a --delete --exclude .DS_Store ~/.claude/skills/mo-pr ~/.claude/skills/mo-update "<dir>/Claude commands/"` (so a new computer can install them from the repo; see `Claude commands/README.md` there, which stays as it is).
5. Check the clone's `git status --short` for deletions (` D`). If many app files would be deleted, stop: the local folder is probably missing work (another session may have stashed it; see `~/Documents/Mo_App/CLAUDE.md`) — tell the user and restore first. If nothing changed (`git status --short` is empty), say so and stop. Otherwise check the app with `npx tsc --noEmit -p tsconfig.json` in `~/Documents/Mo_App/Mo_App_v.02` (Node in `/opt/homebrew/bin`); if it fails, report the errors and still ask before pushing broken code.
6. Commit with a message that says what changed (app files, projects added/updated, doc), ending with the attribution line from the session's system reminder. Push the branch and `gh pr create --repo mr-imruu/Mo_App_v.01 --base main` with a short summary and test plan (PR body attribution line from the system reminder).
7. After the user merges, the local folder can follow with `git -C ~/Documents/Mo_App fetch -q origin main && git -C ~/Documents/Mo_App reset -q origin/main` (files untouched).
8. Bind the PR to the session (ccd_pr `get_status`, then `bind_pr` if it is not bound). Report the PR link, the app files changed, and the projects added or updated. Remind the user the work lands on `main` when they merge the PR.
