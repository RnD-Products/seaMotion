# seaMotion

seaMotion is a browser-based motion design editor. Build a design from layers, set how it moves on a timeline,
preview it, and export it as animation.

Built on [Toolcraft](seaMotion/NOTICE.md) by Pixel Point: seaMotion started from the Toolcraft app starter and
keeps its runtime, under the MIT License (see `seaMotion/LICENSE.md` and `seaMotion/NOTICE.md`).

**Live site:** https://editor-seamotion.vercel.app (opens a set of example projects, read-only)

## What is in this repo

| Folder | What it is |
| --- | --- |
| `seaMotion/` | The app (Vite + TypeScript) |
| `seaMotion/Fig-to-SeaMotion/` | The Figma plugin that copies layers for import into seaMotion (also at [Fig-to-SeaMotion](https://github.com/RnD-Products/Fig-to-SeaMotion)) |
| `Projects/` | Saved project files (`.json`) |
| `Fonts/`, `Presets/` | Fonts and presets the app reads from your computer |
| `Claude commands/` | Helper commands for working on the project with Claude Code |

## Run it locally

You need Node.js and a desktop browser (the app needs a window at least 1024 px wide).

```bash
cd seaMotion
npm install
npm run dev
```

Then open http://localhost:3002. `npm run dev` also starts a small helper that saves your projects automatically
to `~/Documents/seaMotion/Recovered`, and reads fonts and presets from `~/Documents/seaMotion/Fonts` and `Presets`.

Useful commands (run in `seaMotion/`):

```bash
npm run build       # type check and production build into dist/
npm run typecheck   # type check only
npm test            # unit tests
```

## Import from Figma

Use the **Fig-to-SeaMotion** plugin: in Figma choose Plugins > Development > Import plugin from manifest, pick
`seaMotion/Fig-to-SeaMotion/manifest.json`, select layers and press **Copy**, then paste into seaMotion with
**Import**.

## Deploy

The site is hosted on Vercel from the `seaMotion/` folder (`vercel.json` sets the Vite build). The build copies the
projects in `Recovered/` into the site so the Open project page can list them, because the hosted site has no
auto-save helper. To redeploy from your computer:

```bash
cd seaMotion
npx vercel build --prod --yes && npx vercel deploy --prebuilt --prod
```

On the hosted site edits are not saved; saving needs `npm run dev`.

## Project files

A project is one `.json` file (format `mo-app-project`). Open one from the Open project page, or choose
**Browse files...** to load one from disk.
