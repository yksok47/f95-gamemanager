import { app, BrowserWindow, protocol } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { flushDownloadHistory, registerDownloadHandler } from "./downloads";
import { adoptRunningLibrarySessions } from "./game-files-store";
import { registerIpc } from "./ipc";
import { initAdblock } from "./adblock";
import { attachGuestWindowOpenHandler, attachMainWindowGuards } from "./open-url";
import { flushPlaySessions } from "./play-sessions";
import { registerSaveThumbProtocol, SAVE_THUMB_SCHEME } from "./renpy/save-meta";
import { getSettings } from "./settings-store";
import { startCloudUserDataSync, flushCloudUserDataSync } from "./cloud-user-data/sync";
import { destroyWebTorrent, onP2pEnabledChanged } from "./p2p";
import {
  cleanupStaleAppUpdates,
  initAppUpdateStatus,
  isApplyingAppUpdate,
  resumeInterruptedAppUpdate,
  setAppUpdateBeforeExitHook,
  startAppUpdateService,
} from "./app-update";
import { loadSession, persistSessionNow } from "./session-store";
import { registerF95CdnRequestHeaders } from "./f95/cdn-request-headers";
import {
  clearF95ImageCache,
  F95_IMG_SCHEME,
  initF95ImageCache,
  registerF95ImageCache
} from "./f95/image-cache";
import { appIcon } from "./app-icon";

protocol.registerSchemesAsPrivileged([SAVE_THUMB_SCHEME, F95_IMG_SCHEME]);

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
  await initF95ImageCache();
  registerF95CdnRequestHeaders();
  registerF95ImageCache();
  initAdblock();
  const settings = await getSettings();
  registerDownloadHandler();
  registerIpc();
  void startCloudUserDataSync().catch((error) =>
    console.warn("Could not start user-data sync", error)
  );
  if (settings.p2pEnabled) {
    void onP2pEnabledChanged(true).catch((error) =>
      console.warn("[p2p] resume on startup failed", error)
    );
  }
  registerSaveThumbProtocol();
  initAppUpdateStatus();
  setAppUpdateBeforeExitHook(async () => {
    await persistSessionNow().catch((error) =>
      console.warn("Could not persist session on quit", error)
    );
    await flushDownloadHistory().catch((error) =>
      console.warn("Could not persist downloads on quit", error)
    );
    await flushPlaySessions().catch((error) =>
      console.warn("Could not save playtime on quit", error)
    );
    await flushCloudUserDataSync().catch((error) =>
      console.warn("Could not sync user data on quit", error)
    );
    await destroyWebTorrent().catch((error) =>
      console.warn("[p2p] destroy on quit failed", error)
    );
    await clearF95ImageCache().catch((error) =>
      console.warn("[image-cache] clear on quit failed", error)
    );
  });
  await cleanupStaleAppUpdates().catch((error) =>
    console.warn("[app-update] leftover cleanup failed", error)
  );
  if (await resumeInterruptedAppUpdate()) return;
  createWindow();
  void startAppUpdateService();
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
  if (isApplyingAppUpdate()) return;
  if (persistingOnQuit || !app.isReady()) return;
  event.preventDefault();
  persistingOnQuit = true;
  void persistSessionNow()
    .catch((error) => console.warn("Could not persist session on quit", error))
    .then(() => flushDownloadHistory())
    .catch((error) => console.warn("Could not persist downloads on quit", error))
    .then(() => flushPlaySessions())
    .catch((error) => console.warn("Could not save playtime on quit", error))
    .then(() => flushCloudUserDataSync())
    .catch((error) => console.warn("Could not sync user data on quit", error))
    .then(() => destroyWebTorrent())
    .catch((error) => console.warn("[p2p] destroy on quit failed", error))
    .then(() => clearF95ImageCache())
    .catch((error) => console.warn("[image-cache] clear on quit failed", error))
    .finally(() => app.exit(0));
});
