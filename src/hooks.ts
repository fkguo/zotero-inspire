import { config } from "../package.json";
import { initLocale, getString } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { ZInsMenu, ZInsUtils, ZInspireReferencePane } from "./modules/zinspire";
import { localCache } from "./modules/inspire";
import { getPref, setPref } from "./utils/prefs";
import { registerPrefsScripts } from "./modules/prefScript";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);
  initLocale();

  ZInsUtils.registerPrefs();
  ZInsUtils.registerNotifier();

  await onMainWindowLoad(Zotero.getMainWindow());

  // Purge expired local cache entries in background after startup
  setTimeout(() => {
    localCache.purgeExpired().catch(err => {
      Zotero.debug(`[${config.addonName}] Failed to purge expired cache: ${err}`);
    });
  }, 10000); // Delay 10s to avoid startup contention
}

async function onMainWindowLoad(_win: Window): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  ZInspireReferencePane.registerPanel();

  // UIExampleFactory.registerRightClickMenuItem();

  ZInsMenu.registerRightClickMenuPopup();
  ZInsMenu.registerRightClickCollectionMenu();
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  ZInspireReferencePane.unregisterPanel();
  // Flush pending cache writes before shutdown
  localCache.flushWrites().catch(() => {
    // Ignore flush errors during shutdown
  });
  // Remove addon object
  addon.data.alive = false;
  // @ts-ignore - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

/**
 * This function is just an example of dispatcher for Notify events.
 * Any operations should be placed in a function to keep this funcion clear.
 */
async function onNotify(
  event: string,
  type: string,
  ids: Array<any>,
  extraData: { [key: string]: any },
) {
  // You can add your code to the corresponding notify type
  // ztoolkit.log("notify", event, type, ids, extraData);
  if (event === "add") {
    switch (getPref("meta")) {
      case "full":
        _globalThis.inspire.updateItems(Zotero.Items.get(ids), "full");
        break;
      case "noabstract":
        _globalThis.inspire.updateItems(Zotero.Items.get(ids), "noabstract");
        break;
      case "citations":
        _globalThis.inspire.updateItems(Zotero.Items.get(ids), "citations");
        break;
      default:
        break;
    }
  }
  return;
}

/**
 * Update cache statistics display in preferences panel.
 */
async function updateCacheStatsDisplay(doc: Document) {
  const statsEl = doc.getElementById("zotero-prefpane-zoteroinspire-cache_stats");
  if (statsEl) {
    const stats = await localCache.getStats();
    const sizeStr = stats.totalSize < 1024
      ? `${stats.totalSize} B`
      : stats.totalSize < 1024 * 1024
        ? `${(stats.totalSize / 1024).toFixed(1)} KB`
        : `${(stats.totalSize / 1024 / 1024).toFixed(1)} MB`;
    statsEl.textContent = getString("pref-local-cache-stats", {
      args: { count: stats.fileCount, size: sizeStr },
    });
  }
}

/**
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this funcion clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      // Update cache stats and directory display
      if (data.window) {
        const doc = data.window.document;
        updateCacheStatsDisplay(doc);
        // Show current cache directory (actual path being used)
        localCache.getCacheDir().then((dir) => {
          const input = doc.getElementById(
            "zotero-prefpane-zoteroinspire-local_cache_custom_dir"
          ) as HTMLInputElement;
          if (input && dir) {
            const customDir = getPref("local_cache_custom_dir") as string;
            input.value = customDir || "";
            input.placeholder = dir;  // Show actual path being used
            input.title = dir;  // Full path in tooltip
          }
        });
      }
      break;
    case "clearHistory":
      ZInspireReferencePane.clearAllHistory();
      // Show confirmation
      if (data.window) {
        const win = data.window as Window;
        const doc = win.document;
        const button = doc.getElementById("zotero-prefpane-zoteroinspire-clear_history");
        if (button) {
          const originalLabel = button.getAttribute("data-l10n-id");
          button.setAttribute("data-l10n-id", "pref-search-history-cleared");
          setTimeout(() => {
            button.setAttribute("data-l10n-id", originalLabel || "pref-search-history-clear");
          }, 2000);
        }
      }
      break;
    case "clearCache":
      // Clear local cache and show confirmation
      localCache.clearAll().then((count) => {
        if (data.window) {
          const win = data.window as Window;
          const doc = win.document;
          const button = doc.getElementById("zotero-prefpane-zoteroinspire-clear_cache");
          if (button) {
            const originalLabel = button.getAttribute("data-l10n-id");
            // Use fluent for the cleared message
            button.textContent = getString("pref-local-cache-cleared", { args: { count } });
            setTimeout(() => {
              button.setAttribute("data-l10n-id", originalLabel || "pref-local-cache-clear");
              button.textContent = "";  // Let fluent handle the text
            }, 2000);
          }
          // Update stats display
          updateCacheStatsDisplay(doc);
        }
      });
      break;
    case "browseCacheDir":
      // Browse for custom cache directory
      (async () => {
        const prefWin = data.window as Window | undefined;
        const pickerOwner = Zotero.getMainWindow() as Window | null;
        const FilePickerCtor = pickerOwner && (pickerOwner as any).FilePicker;

        if (!pickerOwner || !FilePickerCtor) {
          const alertHost = prefWin ?? pickerOwner;
          if (alertHost && typeof Services !== "undefined") {
            Services.prompt.alert(
              alertHost as unknown as mozIDOMWindowProxy,
              "File Picker Unavailable",
              "Unable to open the directory picker. Please try again from the main Zotero window."
            );
          }
          Zotero.debug(`[${config.addonName}] FilePicker is not available in browseCacheDir handler.`);
          return;
        }

        const fp = new FilePickerCtor();
        const parentForPicker = prefWin ?? pickerOwner;
        fp.init(parentForPicker, "Select Cache Directory", fp.modeGetFolder);

        const result = await fp.show();
        if (result === fp.returnOK && fp.file) {
          // Validate directory is writable before saving
          try {
            const testFile = PathUtils.join(fp.file, ".zotero-inspire-test");
            await IOUtils.writeUTF8(testFile, "test");
            await IOUtils.remove(testFile, { ignoreAbsent: true });
            
            // Directory is writable, save preference
            setPref("local_cache_custom_dir", fp.file);
            // Reinitialize cache with new directory
            await localCache.reinit();
            // Update UI
            const doc = prefWin?.document;
            if (doc) {
              const input = doc.getElementById(
                "zotero-prefpane-zoteroinspire-local_cache_custom_dir"
              ) as HTMLInputElement;
              if (input) {
                input.value = fp.file;
                input.placeholder = fp.file;
                input.title = fp.file;
              }
              updateCacheStatsDisplay(doc);
            }
          } catch (err) {
            // Directory not writable, show error
            const alertHost = prefWin ?? pickerOwner;
            if (alertHost && typeof Services !== "undefined") {
              Services.prompt.alert(
                alertHost as unknown as mozIDOMWindowProxy,
                "Invalid Directory",
                `Selected directory is not writable. Please choose a different location.\n\nError: ${err}`
              );
            }
          }
        }
      })();
      break;
    case "resetCacheDir":
      // Reset to default directory
      setPref("local_cache_custom_dir", "");
      // Reinitialize cache with default directory
      localCache.reinit().then(() => {
        if (data.window) {
          const doc = (data.window as Window).document;
          localCache.getCacheDir().then((dir) => {
            const input = doc.getElementById(
              "zotero-prefpane-zoteroinspire-local_cache_custom_dir"
            ) as HTMLInputElement;
            if (input && dir) {
              input.value = "";
              input.placeholder = dir;  // Show default path
              input.title = dir;
            }
            updateCacheStatsDisplay(doc);
          });
        }
      });
      break;
    default:
      return;
  }
}

// function onShortcuts(type: string) {
// }

// function onDialogEvents(type: string) {
//   switch (type) {
//     case "dialogExample":
//       HelperExampleFactory.dialogExample();
//       break;
//     case "clipboardExample":
//       HelperExampleFactory.clipboardExample();
//       break;
//     case "filePickerExample":
//       HelperExampleFactory.filePickerExample();
//       break;
//     case "progressWindowExample":
//       HelperExampleFactory.progressWindowExample();
//       break;
//     case "vtableExample":
//       HelperExampleFactory.vtableExample();
//       break;
//     default:
//       break;
//   }
// }

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintian.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};
