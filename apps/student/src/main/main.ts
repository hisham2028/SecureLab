import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen, session } from "electron";
import path from "node:path";
import { DraftStore } from "./drafts";
import { IpcChannel, type EnvironmentInfo, type SystemCheck } from "./ipc-contract";
import { ApiClient, isAllowedRequest } from "./api-client";
import { resolveApiUrl } from "./config";

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

const api = new ApiClient(
  resolveApiUrl(process.env, [path.dirname(app.getPath("exe")), app.getPath("userData")]),
);

const MAX_CODE = 256 * 1024;
const isId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const isLanguage = (v: unknown): v is string => v === "c" || v === "cpp" || v === "python";
const isRevision = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 2_000_000_000;
const isCode = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_CODE;
const isTime = (v: unknown): v is string =>
  typeof v === "string" && v.length < 40 && !Number.isNaN(Date.parse(v));

function draftKey(seat: unknown, question: unknown, language: unknown): [string, string, string] {
  if (!isId(seat) || !isId(question) || !isLanguage(language)) throw new Error("Invalid draft key");
  return [seat, question, language];
}

async function systemCheck(): Promise<SystemCheck> {
  const [draftsWritable, ping] = await Promise.all([drafts.probe(), api.ping()]);
  const serverMs = ping.serverDate ? Date.parse(ping.serverDate) : NaN;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return {
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    draftsWritable,
    server: {
      reachable: ping.ok,
      latencyMs: ping.latencyMs,
      // HTTP Date has 1 s resolution; good enough to spot a badly wrong PC clock.
      clockSkewSeconds: Number.isNaN(serverMs) ? null : Math.round((Date.now() - serverMs) / 1000),
    },
    secureConnection:
      api.baseUrl.protocol === "https:" ||
      ["localhost", "127.0.0.1", "[::1]"].includes(api.baseUrl.hostname),
    screen: { width, height },
  };
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.ApiRequest, (_e, method: unknown, p: unknown, body: unknown) => {
    if (!isAllowedRequest(method, p)) throw new Error("Request not allowed");
    return api.request(method, p as string, body);
  });
  ipcMain.handle(IpcChannel.ApiSignOut, () => api.signOut());

  ipcMain.handle(IpcChannel.DraftList, (_e, seat: unknown) => {
    if (!isId(seat)) throw new Error("Invalid seat");
    return drafts.list(seat);
  });
  ipcMain.handle(
    IpcChannel.DraftSave,
    (_e, seat: unknown, q: unknown, lang: unknown, code: unknown, minRevision: unknown) => {
      const key = draftKey(seat, q, lang);
      if (!isCode(code) || !isRevision(minRevision)) throw new Error("Invalid draft content");
      return drafts.save(...key, code, minRevision);
    },
  );
  ipcMain.handle(
    IpcChannel.DraftAdopt,
    (_e, seat: unknown, q: unknown, lang: unknown, code: unknown, rev: unknown, at: unknown) => {
      const key = draftKey(seat, q, lang);
      if (!isCode(code) || !isRevision(rev) || !isTime(at)) throw new Error("Invalid draft");
      return drafts.adopt(...key, code, rev, at);
    },
  );
  ipcMain.handle(
    IpcChannel.DraftMarkSynced,
    (_e, seat: unknown, q: unknown, lang: unknown, rev: unknown, at: unknown) => {
      const key = draftKey(seat, q, lang);
      if (!isRevision(rev) || !isTime(at)) throw new Error("Invalid sync mark");
      return drafts.markSynced(...key, rev, at);
    },
  );

  ipcMain.handle(IpcChannel.EnvironmentInfo, (): EnvironmentInfo => ({
    platform: process.platform,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    apiUrl: api.baseUrl.origin + api.baseUrl.pathname.replace(/\/$/, ""),
  }));
  ipcMain.handle(IpcChannel.SystemCheck, () => systemCheck());
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: "SecureLab",
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

  // The renderer blocks unload while work hasn't reached the server. Ask before closing.
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["Quit anyway", "Keep working"],
      defaultId: 1,
      cancelId: 1,
      title: "Some work isn't on the server yet",
      message: "Some of your work hasn't reached the exam server yet.",
      detail:
        "It is saved on this computer and will be sent when you open SecureLab again. " +
        "If you're moving to another computer, tell the invigilator first.",
    });
    if (choice === 0) event.preventDefault();
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
