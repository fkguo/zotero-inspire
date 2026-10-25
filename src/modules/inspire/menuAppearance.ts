import { config } from "../../../package.json";
import type { FluentMessageId } from "../../../typings/i10n";
import { getString } from "../../utils/locale";

export const INSPIRE_MENU_ICON = `chrome://${config.addonRef}/content/icons/inspire-menu.png`;

export function menuLabel(key: FluentMessageId, showIcon = false) {
  return (
    _event: Event,
    { menuElem }: _ZoteroTypes.MenuManager.BaseMenuContext,
  ) => {
    menuElem.setAttribute("label", getString(key));
    if (showIcon) {
      // Set the image explicitly as well as through Zotero's icon variables.
      menuElem.setAttribute("image", INSPIRE_MENU_ICON);
      menuElem.style.setProperty(
        "list-style-image",
        `url("${INSPIRE_MENU_ICON}")`,
      );
    }
  };
}
