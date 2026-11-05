---
name: mo-update
description: Update the local Mo_App from GitHub (mr-imruu/Mo_App_v.01 main) - merge project files into ~/Documents/Mo_App/Projects, trash the old app folder, install, and open the app once. Use when the user types /mo-update or says "mo update", "update mo app", "update app from github" or similar.
---

# Mo_App update from GitHub

Run every step without asking again; the user already approved this exact procedure. Never hard-delete anything: old folders go to the macOS Trash and project files are never removed.

1. Download the latest `https://github.com/mr-imruu/Mo_App_v.01` (`main`) into a fresh folder in the scratchpad (`gh repo clone mr-imruu/Mo_App_v.01 <dir> -- -q`). Its layout is `Mo_App_v.02/` (the app; `Mo_App_v.01/` in versions before the rename, use whichever exists), `Projects/` (project JSONs), `Fonts/` and `Presets/`.
2. Merge project files into `~/Documents/Mo_App/Projects`:
   - Copy every `.json` from the repo's `Projects/` that is new there or identical-named but different.
   - When a same-named project differs, overwrite it with the GitHub version only if the old local copy is byte-identical to a file in `~/Documents/Mo_App/Recovered` (so it is still kept). Otherwise save the GitHub one as `<name> (github).json`.
   - When the GitHub file is byte-identical to the file of the same name in `~/Documents/Mo_App/Recovered` (the newest autosave is what GitHub holds), overwrite the local `Projects/<name>.json` with it and do not create a `(github)` copy.
   - Copy any `.json` from `~/Documents/Mo_App/Mo_App_v.02/Projects` (if that folder exists) into `~/Documents/Mo_App/Projects`, skipping names that already exist.
2b. Fonts and presets: copy any file from the repo's `Fonts/` and `Presets/` that is missing locally into `~/Documents/Mo_App/Fonts/` and `~/Documents/Mo_App/Presets/` (never overwrite or delete a local file; if a same-named file differs, keep the local one and say so).
3. Leave `~/Documents/Mo_App/Recovered` untouched; the app autosaves there.
4. Stop the running dev server (background task or whatever listens on port 3002/3011). Move `~/Documents/Mo_App/Mo_App_v.02` to `~/.Trash/Mo_App_v.02 old <YYYY-MM-DD>` (add a number if that name exists). Copy the repo's app folder (`Mo_App_v.02/`, or `Mo_App_v.01/` before the rename) into `~/Documents/Mo_App/Mo_App_v.02` with `rsync -a --exclude .git`.
4b. `~/Documents/Mo_App` is a git checkout of `mr-imruu/Mo_App_v.01` (`main`): run `git -C ~/Documents/Mo_App fetch -q origin main && git -C ~/Documents/Mo_App reset -q origin/main` (a plain reset: it moves the record, never the files), so the folder's git matches GitHub. Never switch branches, stash or hard-reset there (see `~/Documents/Mo_App/CLAUDE.md`).
5. In `~/Documents/Mo_App/Mo_App_v.02` (Node is in `/opt/homebrew/bin`): `npm install --no-audit --no-fund`, then `npx tsc --noEmit -p tsconfig.json`, then start `npm run dev` in the background. Wait until `http://127.0.0.1:3002/` answers, then open it once in the in-app browser with `preview_start` name `dev` (from `.claude/launch.json`) and check the console for errors.
6. Report briefly: which projects were added, replaced, renamed (github) or skipped; where the old app went in the Trash; latest GitHub commit; and that the app opened (or the errors).
