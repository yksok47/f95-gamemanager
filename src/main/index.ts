import { app, BrowserWindow } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { flushDownloadHistory, registerDownloadHandler } from "./downloads";
import { adoptRunningLibrarySessions } from "./game-files-store";
import { registerIpc } from "./ipc";
import { attachGuestWindowOpenHandler, attachMainWindowGuards } from "./open-url";
import { flushPlaySessions } from "./play-sessions";
import { registerSaveThumbProtocol, registerSaveThumbScheme } from "./renpy/save-meta";
import { getSettings } from "./settings-store";
import { destroyWebTorrent, onP2pEnabledChanged } from "./p2p";
import { loadSession, persistSessionNow } from "./session-store";
import { appIcon } from "./app-icon";

registerSaveThumbScheme();

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: "F95 Game Manager",
    icon: appIcon,
    backgroundColor: "#12141a",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  attachMainWindowGuards(mainWindow, (url) => {
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      return url.startsWith(process.env["ELECTRON_RENDERER_URL"]);
    }
    return url.startsWith("file:");
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.f95gamemanager.app");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  attachGuestWindowOpenHandler();
  await loadSession();
  const settings = await getSettings();
  registerDownloadHandler();
  registerIpc();
  if (settings.p2pEnabled) {
    void onP2pEnabledChanged(true).catch((error) =>
      console.warn("[p2p] resume on startup failed", error)
    );
  }
  registerSaveThumbProtocol();
  createWindow();
  void adoptRunningLibrarySessions().catch((error) =>
    console.warn("Could not adopt running game processes", error)
  );

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let persistingOnQuit = false;

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (persistingOnQuit || !app.isReady()) return;
  event.preventDefault();
  persistingOnQuit = true;
  void persistSessionNow()
    .catch((error) => console.warn("Could not persist session on quit", error))
    .then(() => flushDownloadHistory())
    .catch((error) => console.warn("Could not persist downloads on quit", error))
    .then(() => flushPlaySessions())
    .catch((error) => console.warn("Could not save playtime on quit", error))
    .then(() => destroyWebTorrent())
    .catch((error) => console.warn("[p2p] destroy on quit failed", error))
    .finally(() => app.exit(0));
});
