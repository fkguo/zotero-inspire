import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
export function registerPrefsScripts(_window: Window) {
  if (!addon.data.prefs) {
    addon.data.prefs = {window: _window};
  } else {
    addon.data.prefs.window = _window;
  }
  const input = _window.document.querySelector(`#zotero-prefpane-${config.addonRef}-tag_norecid`) as HTMLInputElement;
  input.disabled = !getPref("tag_enable");
  bindTagEnabler();
}

function bindTagEnabler() {
  addon.data.prefs!.window.document.querySelector(`#zotero-prefpane-${config.addonRef}-tag_enable`)?.addEventListener("command", (e) => {
    const checkbox = e.target as XULCheckboxElement;
    const input = addon.data.prefs!.window.document.querySelector(`#zotero-prefpane-${config.addonRef}-tag_norecid`) as HTMLInputElement;
    input.disabled = !checkbox.checked;
    setPref("tag_enable", checkbox.checked);
    // ztoolkit.log(getPref("tag_enable"));
  })
}
