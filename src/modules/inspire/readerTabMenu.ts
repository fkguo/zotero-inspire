import { config } from "../../../package.json";
import type { FluentMessageId } from "../../../typings/i10n";
import { deriveRecidFromItem, inspireLiteratureUrl } from "./apiUtils";
import { INSPIRE_MENU_ICON, menuLabel } from "./menuAppearance";

type TabContext = _ZoteroTypes.MenuManager.TabMenuContext;
type TabMenu = _ZoteroTypes.MenuManager.MenuData<TabContext>;

let registeredMenu: string | false = false;

function pdfPaper(context: TabContext): Zotero.Item | null {
  const attachment = context.items?.[0];
  if (!attachment || !attachment.isPDFAttachment() || !attachment.parentID)
    return null;
  const paper = Zotero.Items.get(attachment.parentID);
  return paper && paper.isRegularItem() ? paper : null;
}

function paperCommand(
  key: FluentMessageId,
  run: (paper: Zotero.Item) => unknown,
  needsRecid = false,
): TabMenu {
  const label = menuLabel(key);
  return {
    menuType: "menuitem",
    onShowing: (event, context) => {
      label(event, context);
      const paper = pdfPaper(context);
      context.setEnabled(
        !!paper && (!needsRecid || !!deriveRecidFromItem(paper)),
      );
    },
    onCommand: (_event, context) => {
      const paper = pdfPaper(context);
      if (paper && (!needsRecid || deriveRecidFromItem(paper)))
        return run(paper);
    },
  };
}

export function registerInspireReaderTabMenu(): void {
  if (registeredMenu) return;
  const rootLabel = menuLabel("menupopup-label", true);
  registeredMenu = Zotero.MenuManager.registerMenu({
    menuID: `${config.addonRef}-pdf-tab`,
    pluginID: config.addonID,
    target: "main/tab",
    menus: [
      {
        menuType: "submenu",
        icon: INSPIRE_MENU_ICON,
        onShowing: (event, context) => {
          rootLabel(event, context);
          context.setVisible(!!pdfPaper(context));
        },
        menus: [
          paperCommand(
            "menuitem-open-inspire",
            (paper) =>
              Zotero.launchURL(
                inspireLiteratureUrl(deriveRecidFromItem(paper)!),
              ),
            true,
          ),
          { menuType: "separator" },
          paperCommand("menuitem-submenulabel0", (paper) =>
            _globalThis.inspire.updateSelectedItems("full", [paper]),
          ),
          paperCommand("menuitem-submenulabel1", (paper) =>
            _globalThis.inspire.updateSelectedItems("noabstract", [paper]),
          ),
          paperCommand("menuitem-submenulabel2", (paper) =>
            _globalThis.inspire.updateSelectedItems("citations", [paper]),
          ),
          { menuType: "separator" },
          paperCommand(
            "menuitem-copy-bibtex",
            (paper) => _globalThis.inspire.copyBibTeX([paper]),
            true,
          ),
          paperCommand("menuitem-copy-citation-key", (paper) =>
            _globalThis.inspire.copyCitationKey([paper]),
          ),
          paperCommand(
            "menuitem-copy-inspire-recid",
            (paper) => _globalThis.inspire.copyInspireRecid([paper]),
            true,
          ),
          paperCommand(
            "menuitem-copy-inspire-link",
            (paper) => _globalThis.inspire.copyInspireLink([paper]),
            true,
          ),
          paperCommand(
            "menuitem-copy-inspire-link-md",
            (paper) => _globalThis.inspire.copyInspireLinkMarkdown([paper]),
            true,
          ),
          paperCommand("menuitem-copy-zotero-link", (paper) =>
            _globalThis.inspire.copyZoteroLink([paper]),
          ),
          { menuType: "separator" },
          {
            menuType: "menuitem",
            onShowing: menuLabel("menuitem-copy-funding"),
            onCommand: (_event, context) => {
              if (pdfPaper(context))
                return _globalThis.inspire.copyFundingInfo(context.items);
            },
          },
          paperCommand("preprint-check-menu", (paper) =>
            _globalThis.inspire.checkSelectedItemsPreprints([paper]),
          ),
          paperCommand("menuitem-favorite-paper", (paper) =>
            _globalThis.inspire.toggleFavoritePaperFromMenu([paper]),
          ),
        ],
      },
    ],
  });
}

export function unregisterInspireReaderTabMenu(): void {
  if (!registeredMenu) return;
  Zotero.MenuManager.unregisterMenu(registeredMenu);
  registeredMenu = false;
}
