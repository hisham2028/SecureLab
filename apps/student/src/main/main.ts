import { app, BrowserWindow, ipcMain, safeStorage, session } from "electron";
import path from "node:path";
import { DraftStore } from "./drafts";
import { IpcChannel, type EnvironmentInfo } from "./ipc-contract";

/**
 * Electron main process. Full-screen here is a convenience, not lockdown: real exam lockdown
 * is an OS / device-management capability planned for release 1.2 (see docs/adr/0002).
 */
const devUrl = process.env.SECURELAB_DEV_URL;
const isDev = Boolean(devUrl) && !app.isPackaged;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const drafts = new DraftStore(path.join(app.getPath("userData"), "drafts"), {
  encrypt: (plain) =>
    safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(plain)
      : Buffer.from(plain, "utf8"),
  decrypt: (data) =>
    safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString("utf8"),
});

const isId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

function registerIpc(): void {
  ipcMain.handle(IpcChannel.DraftLoad, (_e, attemptId: unknown, questionId: unknown) => {
    if (!isId(attemptId) || !isId(questionId)) throw new Error("Invalid draft key");
    return drafts.load(attemptId, questionId);
  });
  ipcMain.handle(
    IpcChannel.DraftSave,
    (_e, attemptId: unknown, questionId: unknown, code: unknown) => {
      if (!isId(attemptId) || !isId(questionId)) throw new Error("Invalid draft key");
      if (typeof code !== "string" || code.length > 512 * 1024)
        throw new Error("Invalid draft content");
      return drafts.save(attemptId, questionId, code);
    },
  );
  ipcMain.handle(IpcChannel.EnvironmentInfo, (): EnvironmentInfo => ({
    platform: process.platform,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  }));
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
      spellcheck: false,
    },
  });

  // The window may only ever show the bundled app (or the dev server in development).
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (isDev && url.startsWith(devUrl!)) return;
    event.preventDefault();
  });

  win.once("ready-to-show", () => win.show());

  if (isDev) {
    void win.loadURL(devUrl!);
  } else {
    void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }
}

app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

app.whenReady().then(() => {
  // Deny every permission request (camera, mic, notifications, etc.) by default.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  registerIpc();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
