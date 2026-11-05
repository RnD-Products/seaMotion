# Claude commands for Mo_App

Two commands for Claude Code: **mo-pr** (save app, projects, fonts, presets and these commands to GitHub as a pull request) and **mo-update** (pull the latest from GitHub).

## Install on a new computer

Run this once (replace `FOLDER` with the folder where you cloned this repo, the one that holds `Mo_App_v.02` and `Projects`):

```bash
mkdir -p ~/.claude/skills
cp -R "FOLDER/Claude commands/mo-pr" "FOLDER/Claude commands/mo-update" ~/.claude/skills/
```

Then say "mo pr" or "mo update" in Claude Code.

## Folder path

The command files name the folder `~/Documents/Mo_App`. If your Mo_App folder is somewhere else, tell Claude the path when you start ("FOLDER: /path/to/Mo_App") and it uses that path instead.
