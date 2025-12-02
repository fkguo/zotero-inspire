import { config } from "../package.json";
import { initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import { ZInsMenu, ZInsUtils, ZInspireReferencePane } from "./modules/zinspire";
import { getPref } from "./utils/prefs";
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
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this funcion clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
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
