import {
    App,
    FuzzySuggestModal,
    Notice,
    Plugin,
    PluginSettingTab,
    SettingDefinitionItem,
    TFile,
    TFolder,
    normalizePath,
} from "obsidian";

interface TaskCheckerSettings {
    excludedFolders: string[];
    excludedFiles: string[];
}

const DEFAULT_SETTINGS: TaskCheckerSettings = {
    excludedFolders: [],
    excludedFiles: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Pulls a string array out of JSON text that failed to parse, e.g. when a
 * comma is missing between entries. Returns null when the key is absent.
 */
function extractStringArrayLoose(raw: string, key: string): string[] | null {
    const match = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(raw);
    if (!match) {
        return null;
    }
    const start = match.index + match[0].length;
    const end = raw.indexOf("]", start);
    if (end === -1) {
        return null;
    }
    const body = raw.slice(start, end);
    const values: string[] = [];
    const stringLiteral = /"((?:[^"\\]|\\.)*)"/g;
    let item: RegExpExecArray | null;
    while ((item = stringLiteral.exec(body)) !== null) {
        try {
            values.push(JSON.parse(`"${item[1]}"`) as string);
        } catch {
            values.push(item[1]);
        }
    }
    return values;
}

/**
 * Turns a stored exclusion into a vault-relative path.
 * Older settings used absolute filesystem paths; those are mapped onto
 * a vault file or folder when a matching suffix exists.
 */
function toVaultRelativePath(stored: string, knownPaths: string[]): string {
    const normalized = normalizePath(stored.replace(/\\/g, "/")).replace(/\/$/, "");
    if (!normalized) {
        return "";
    }
    if (knownPaths.includes(normalized)) {
        return normalized;
    }

    const parts = normalized.split("/").filter((part) => part.length > 0);
    for (let i = 0; i < parts.length; i++) {
        const candidate = parts.slice(i).join("/");
        if (knownPaths.includes(candidate)) {
            return candidate;
        }
    }

    return normalized;
}

function parseSettings(data: unknown, knownPaths: string[]): TaskCheckerSettings {
    const record = isRecord(data) ? data : {};
    const folders = isStringArray(record.excludedFolders) ? record.excludedFolders : [];
    const files = isStringArray(record.excludedFiles) ? record.excludedFiles : [];

    return {
        excludedFolders: folders
            .map((folder) => toVaultRelativePath(folder, knownPaths))
            .filter((folder) => folder.length > 0),
        excludedFiles: files
            .map((file) => toVaultRelativePath(file, knownPaths))
            .filter((file) => file.length > 0),
    };
}

function fileToWikiLink(file: TFile): string {
    const linkPath = file.path.replace(/\.md$/i, "");
    return `[[${linkPath}]]`;
}

function isExcludedFolder(filePath: string, excludedFolders: string[]): boolean {
    return excludedFolders.some((folder) => {
        if (!folder) {
            return false;
        }
        return filePath === folder || filePath.startsWith(`${folder}/`);
    });
}

/**
 * Scans the vault for notes with incomplete tasks (`- [ ]`) and can write
 * a dated list of wikilinks, or report how many such notes exist.
 */
export default class MyTaskChecker extends Plugin {
    settings: TaskCheckerSettings = { ...DEFAULT_SETTINGS };
    /** Set when data.json exists but cannot be read; blocks overwriting it. */
    private settingsFileUnreadable = false;
    private saveBlockedNoticeShown = false;

    async loadSettings() {
        const knownPaths = this.app.vault.getAllLoadedFiles().map((file) => file.path);

        let loadedData: unknown = null;
        try {
            loadedData = await this.loadData();
        } catch (error: unknown) {
            console.error("Task Checker: data.json is not valid JSON", error);
        }

        if (loadedData != null) {
            this.settings = parseSettings(loadedData, knownPaths);
            return;
        }

        const raw = await this.readSettingsFile();
        if (raw == null || raw.trim() === "") {
            this.settings = { ...DEFAULT_SETTINGS };
            return;
        }

        const folders = extractStringArrayLoose(raw, "excludedFolders") ?? [];
        const files = extractStringArrayLoose(raw, "excludedFiles") ?? [];
        if (folders.length === 0 && files.length === 0) {
            this.settings = { ...DEFAULT_SETTINGS };
            this.settingsFileUnreadable = true;
            new Notice("Task Checker: data.json is corrupt. Fix the file, then reload the plugin.");
            return;
        }

        this.settings = parseSettings({ excludedFolders: folders, excludedFiles: files }, knownPaths);
        await this.saveSettings();
        new Notice("Task Checker repaired your settings file (data.json).");
    }

    async saveSettings() {
        if (this.settingsFileUnreadable) {
            if (!this.saveBlockedNoticeShown) {
                this.saveBlockedNoticeShown = true;
                new Notice("Task Checker: not saving because data.json is corrupt. Fix the file, then reload the plugin.");
            }
            return;
        }
        await this.saveData(this.settings);
    }

    private async readSettingsFile(): Promise<string | null> {
        try {
            return await this.app.vault.adapter.read(normalizePath(`${this.manifest.dir}/data.json`));
        } catch {
            return null;
        }
    }

    async onload() {
        try {
            await this.loadSettings();
        } catch (error: unknown) {
            console.error("Task Checker: Error loading settings, using defaults", error);
            this.settings = { ...DEFAULT_SETTINGS };
        }

        this.addSettingTab(new TaskCheckerSettingTab(this.app, this));

        this.addRibbonIcon("check-circle", "List files with tasks", () => {
            this.run(() => this.listFilesWithTasks(), "Could not write the list of files with tasks.");
        });

        this.addCommand({
            id: "list-files-with-tasks",
            name: "List files with tasks",
            callback: () => {
                this.run(() => this.listFilesWithTasks(), "Could not write the list of files with tasks.");
            },
        });

        this.addCommand({
            id: "show-task-count",
            name: "Show task count",
            callback: () => {
                this.run(() => this.showTaskCount(), "Could not count files with tasks.");
            },
        });
    }

    /** Runs an async command from a void-returning callback, reporting failures. */
    private run(task: () => Promise<void>, failureMessage: string): void {
        task().catch((error: unknown) => {
            console.error(`Task Checker: ${failureMessage}`, error);
            new Notice(failureMessage);
        });
    }

    async listFilesWithTasks() {
        const filesWithTasks = await this.getFilesWithTasks();

        if (filesWithTasks.length === 0) {
            new Notice("No files with tasks found.");
            return;
        }

        const fileList = filesWithTasks.map(fileToWikiLink).join("\n");
        const localDate = new Date().toLocaleDateString("en-CA");
        const fileName = `todo-files-${localDate}.md`;
        const existing = this.app.vault.getAbstractFileByPath(fileName);

        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, fileList);
        } else {
            await this.app.vault.create(fileName, fileList);
        }

        new Notice(`Files with tasks have been written to ${fileName}`);
    }

    async showTaskCount() {
        const filesWithTasks = await this.getFilesWithTasks();
        new Notice(`Total number of files with tasks: ${filesWithTasks.length}`);
    }

    async getFilesWithTasks(): Promise<TFile[]> {
        const filesWithTasks: TFile[] = [];
        const markdownFiles = this.app.vault.getMarkdownFiles();

        for (const file of markdownFiles) {
            if (isExcludedFolder(file.path, this.settings.excludedFolders)) {
                continue;
            }
            if (this.settings.excludedFiles.includes(file.path)) {
                continue;
            }

            try {
                const content = await this.app.vault.cachedRead(file);
                if (content.includes("- [ ]")) {
                    filesWithTasks.push(file);
                }
            } catch (error: unknown) {
                console.error(`Task Checker: Unable to read ${file.path}`, error);
            }
        }

        return filesWithTasks;
    }
}

class FolderPickerModal extends FuzzySuggestModal<TFolder> {
    private readonly onPick: (folder: TFolder) => void;

    constructor(app: App, onPick: (folder: TFolder) => void) {
        super(app);
        this.onPick = onPick;
        this.setPlaceholder("Select a folder");
    }

    getItems(): TFolder[] {
        return this.app.vault
            .getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder && file.path !== "/");
    }

    getItemText(folder: TFolder): string {
        return folder.path;
    }

    onChooseItem(folder: TFolder): void {
        this.onPick(folder);
    }
}

class FilePickerModal extends FuzzySuggestModal<TFile> {
    private readonly onPick: (file: TFile) => void;

    constructor(app: App, onPick: (file: TFile) => void) {
        super(app);
        this.onPick = onPick;
        this.setPlaceholder("Select a file");
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile): void {
        this.onPick(file);
    }
}

class TaskCheckerSettingTab extends PluginSettingTab {
    plugin: MyTaskChecker;

    constructor(app: App, plugin: MyTaskChecker) {
        super(app, plugin);
        this.plugin = plugin;
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        const folders = this.plugin.settings.excludedFolders;
        const files = this.plugin.settings.excludedFiles;

        return [
            {
                type: "list" as const,
                heading: "Excluded folders",
                emptyState: "No folders excluded.",
                addItem: {
                    name: "Add folder",
                    action: () => {
                        new FolderPickerModal(this.app, (folder) => {
                            folders.push(folder.path);
                            this.persist(true);
                        }).open();
                    },
                },
                onReorder: (oldIndex: number, newIndex: number) => {
                    const [moved] = folders.splice(oldIndex, 1);
                    folders.splice(newIndex, 0, moved);
                    this.persist(false);
                },
                onDelete: (idx: number) => {
                    folders.splice(idx, 1);
                    this.persist(true);
                },
                items: folders.map((folder) => ({
                    name: folder || "(no folder selected)",
                    searchable: false,
                    action: (el: HTMLElement, index: number) => {
                        new FolderPickerModal(this.app, (picked) => {
                            folders[index] = picked.path;
                            this.persist(true);
                        }).open();
                    },
                })),
            },
            {
                type: "list" as const,
                heading: "Excluded files",
                emptyState: "No files excluded.",
                addItem: {
                    name: "Add file",
                    action: () => {
                        new FilePickerModal(this.app, (file) => {
                            files.push(file.path);
                            this.persist(true);
                        }).open();
                    },
                },
                onReorder: (oldIndex: number, newIndex: number) => {
                    const [moved] = files.splice(oldIndex, 1);
                    files.splice(newIndex, 0, moved);
                    this.persist(false);
                },
                onDelete: (idx: number) => {
                    files.splice(idx, 1);
                    this.persist(true);
                },
                items: files.map((file) => ({
                    name: file || "(no file selected)",
                    searchable: false,
                    action: (el: HTMLElement, index: number) => {
                        new FilePickerModal(this.app, (picked) => {
                            files[index] = picked.path;
                            this.persist(true);
                        }).open();
                    },
                })),
            },
        ];
    }

    /**
     * Saves from a void-returning list callback. Obsidian does not await these,
     * so the rejection has to be handled here.
     */
    private persist(rebuild: boolean): void {
        this.plugin
            .saveSettings()
            .then(() => {
                if (rebuild) {
                    this.update();
                }
            })
            .catch((error: unknown) => {
                console.error("Task Checker: Error saving settings", error);
                new Notice("Could not save settings.");
            });
    }
}
