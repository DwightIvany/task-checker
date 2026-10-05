# Task Checker

An [Obsidian](https://obsidian.md) plugin that scans your vault for notes containing incomplete tasks (`- [ ]`) and writes a dated list of links to a file. 

This helps me maintain a system I trust to track action items. I am a fan of David Allen's **Getting Things Done**. He suggested never mixing action items with reference material. Obsidian makes it really easy to confuse those.

Maybe you have Tasks items in a limited set of Files and Folders, and you trust that you will track those nicely. Set up those to be excluded, like Projects and Daily. Then during your reviews (I like weekly review) click the icon for the plugin and see, if there are actions in other places like Reference folders. I then like to move or action those.

## How to Use
1. Install and Enable the Plugin
2. Add Exclude entries for the Files and Folders that you like to have Task
3. Click the Check Box icon in the Sidebar Panel
Result: it creates a MarkDown file in your vault with other files that have Tasks
ex. todo-files-2026-09-13 

## Features

- **List files with tasks** — scans markdown notes in your vault and writes `todo-files-YYYY-MM-DD.md` to the vault root, containing one `[[wikilink]]` per note that has at least one unchecked task
- **Show task count** — displays a notice with the number of notes containing incomplete tasks
- **Ribbon icon** — the check-circle icon in the ribbon runs the same scan as the command
- **Exclusions** — configure excluded folders and excluded files in settings
- **Settings search** — exclusions use Obsidian's declarative settings API so they appear in settings search on Obsidian 1.13.0 or later

## Requirements

- Obsidian 1.13.0 or later

## Installation

Download `main.js` and `manifest.json` from the [latest release](https://github.com/DwightIvany/task-checker/releases/latest) and copy them into your vault's plugin folder:

```
<your vault>/.obsidian/plugins/my-task-checker/
```

Create the `my-task-checker` folder if it doesn't exist. Then enable the plugin under **Settings → Community plugins**.

## Usage

1. Click the check-circle ribbon icon, or run the **List files with tasks** command
2. Open the generated `todo-files-YYYY-MM-DD.md` in the vault root — each line links to a note with open tasks
3. Work through the list; delete the file when you're done

The **Show task count** command reports how many notes contain incomplete tasks without writing a file.

## Configuration

Go to **Settings → Task Checker**:

- **Excluded folders** — vault folders skipped during the scan (the folder and everything under it)
- **Excluded files** — individual notes skipped during the scan

Use the list controls to add, reorder, and remove entries. Paths are stored relative to the vault. If you previously saved absolute filesystem paths, they are converted to vault-relative paths when settings load.

Entries are stored in the plugin's `data.json`.

## Building from source

With Node.js installed:

```bash
npm install
npm run build        # writes main.js to this folder (repo root)
```

For development with watch mode:

```bash
npm run dev
```

Lint and typecheck with the same rules the Obsidian plugin review applies:

```bash
npm run lint
npm run typecheck
```

On Windows without Node/npm, use the standalone build script (downloads `tools/esbuild.exe` on first run):

```powershell
.\build.ps1
```

The script builds `main.js` in the repo root and copies `main.js` and `manifest.json` into `..\..\ToDo\personal\.obsidian\plugins\my-task-checker` (relative to this folder), ready to reload in Obsidian.

## Releasing

1. Set the same version in `package.json` and `manifest.json`, and add it to `versions.json`.
2. Commit the change, then push an annotated tag that matches that version exactly (no `v` prefix):

```bash
git tag -a 1.3.1 -m "1.3.1"
git push origin 1.3.1
```

GitHub Actions builds `main.js`, attests `main.js` and `manifest.json`, and publishes those files on the GitHub release. Upload the repository `manifest.json` unchanged so it matches the release.

## License

[Apache License 2.0](LICENSE)
