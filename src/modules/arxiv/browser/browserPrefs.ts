// ─────────────────────────────────────────────────────────────────────────────
// The arXiv browser's section of the plugin's settings: the list of
// subscriptions to open with is filled when the pane opens (the other
// settings are bound to their preferences in preferences.xhtml).
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { getLocaleID } from "../../../utils/locale";
import { getPref, setPref } from "../../../utils/prefs";
import { loadSubscriptions } from "./subscriptions";

export function initArxivBrowserPrefs(doc: Document): void {
  const id = (name: string) => `zotero-prefpane-${config.addonRef}-${name}`;
  const menulist = doc.getElementById(
    id("arxiv_browser_default_subscription"),
  ) as (XULElement & { value: string; disabled: boolean }) | null;
  const popup = menulist?.querySelector("menupopup");
  if (!menulist || !popup) return;
  const create = (label: string | null, value: string) => {
    const item = (doc as any).createXULElement("menuitem") as XULElement;
    if (label === null) {
      item.setAttribute(
        "data-l10n-id",
        getLocaleID("pref-arxiv-browser-first-subscription"),
      );
    } else {
      item.setAttribute("label", label);
    }
    item.setAttribute("value", value);
    return item;
  };
  const subscriptions = loadSubscriptions();
  popup.replaceChildren(
    create(null, ""),
    ...subscriptions.map((subscription) =>
      create(subscription.name, subscription.id),
    ),
  );
  const chosen = String(getPref("arxiv_browser_default_subscription") ?? "");
  menulist.value = subscriptions.some((item) => item.id === chosen)
    ? chosen
    : "";
  menulist.disabled = subscriptions.length === 0;
  const note = doc.getElementById(id("arxiv_browser_no_subscription"));
  if (note) note.hidden = subscriptions.length > 0;
  menulist.addEventListener("command", () =>
    setPref("arxiv_browser_default_subscription", menulist.value),
  );
}
