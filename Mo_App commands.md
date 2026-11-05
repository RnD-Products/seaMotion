# Mo_App commands

Two saved commands: `/mo-update` brings the latest app from GitHub to this Mac, and `/mo-pr` saves this Mac's app, projects and this doc to GitHub. Online copy: https://claude.ai/code/artifact/9dee5ca6-760f-4788-b8aa-082c504971ab

## Update from GitHub: mo-update

In Claude Code, type `/mo-update` (or say "mo update") and the agent runs the whole update with no questions. For any other agent, such as Codex, paste the prompt below.

- Downloads the latest app from https://github.com/mr-imruu/Mo_App_v.02 (main).
- Merges project files into `~/Documents/Mo_App/Projects` and never deletes a project.
- Leaves `~/Documents/Mo_App/Recovered` alone, because the app autosaves there.
- Moves the old app folder to the Trash, then installs the new app and opens it once.

### Full prompt

```text
Update my local Mo_App from GitHub, then open the app once.

1. Download the latest https://github.com/mr-imruu/Mo_App_v.02 (main) into a temporary folder.
2. Merge project files into ~/Documents/Mo_App/Projects — never delete any project:
   - Copy every .json from the repo's Projects/ that is new or different.
   - If a project with the same name differs, keep the newer GitHub version only when my old copy also exists in ~/Documents/Mo_App/Recovered; otherwise save the GitHub one as "<name> (github).json".
   - Also move any .json from ~/Documents/Mo_App/Mo_App_v.02/Projects into ~/Documents/Mo_App/Projects (skip names that already exist).
3. Leave ~/Documents/Mo_App/Recovered exactly as it is (the app autosaves there).
4. Stop the dev server if it's running, move the old ~/Documents/Mo_App/Mo_App_v.02 folder to the Trash (don't hard-delete), and copy the repo's Mo_App_v.02/ folder in its place (without .git).
5. In ~/Documents/Mo_App/Mo_App_v.02 run npm install, then npm run dev, and open http://127.0.0.1:3002 once in the in-app browser.
6. Tell me which projects were added, replaced or skipped, and confirm the app opened without errors.
```

## Save to GitHub: mo-pr

In Claude Code, type `/mo-pr` (or say "mo pr") and the agent saves the app, all projects and this doc to GitHub as a pull request. The work lands on `main` when you merge the PR.

### Full prompt

```text
Save my local Mo_App to GitHub as a pull request on https://github.com/mr-imruu/Mo_App_v.02 (base main).

1. Clone main fresh into a temporary folder and create a branch named mo-pr-<date-time>.
2. App: copy ~/Documents/Mo_App/Mo_App_v.02 into the repo's Mo_App_v.02/ folder (rsync --delete, excluding node_modules, dist, .git, .toolcraft, .DS_Store, Projects).
3. Projects: make the repo's Projects/ an exact copy of ~/Documents/Mo_App/Projects (rsync --delete, excluding .DS_Store). Projects I deleted locally are deleted in the repo too. Don't push Recovered.
4. Doc: copy ~/Documents/Mo_App/Mo_App commands.md to the repo root.
5. If nothing changed, tell me and stop. Otherwise run npx tsc --noEmit -p tsconfig.json in the app folder; if it fails, show me the errors and ask before pushing.
6. Commit, push the branch and open the pull request with a short summary. Don't merge it.
7. Tell me the PR link, the app files changed and the projects added or updated.
```
