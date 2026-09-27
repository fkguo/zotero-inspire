// ─────────────────────────────────────────────────────────────────────────────
// Reporter - where a panel shows its notices and progress
//
// The References panel uses Zotero's progress popups next to the main window
// (popupReporter). A panel in another window can show both in an area of its
// own by passing its own Reporter.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "../../../../package.json";
import { ProgressWindowHelper } from "zotero-plugin-toolkit";

/** A progress display opened by Reporter.startProgress. */
export interface ProgressDisplay {
  /** Show new text with the completion in percent (0-100). */
  update(text: string, percent: number): void;
  /** Remove the display. */
  close(): void;
}

/** Where a panel shows its notices and progress. */
export interface Reporter {
  /** A short notice that goes away by itself. */
  notify(message: string): void;
  /** A progress display, first showing `text` at 0 %. */
  startProgress(text: string): ProgressDisplay;
}

const ICON = `chrome://${config.addonRef}/content/icons/inspire-icon.png`;

/** Zotero's progress popups next to the main window. */
export const popupReporter: Reporter = {
  notify(message) {
    const toast = new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
    });
    toast.win.changeHeadline(config.addonName, ICON);
    toast.createLine({ text: message });
    toast.show();
    toast.startCloseTimer(3000);
  },

  startProgress(text) {
    const progressWindow = new ProgressWindowHelper(config.addonName);
    progressWindow.win.changeHeadline(config.addonName, ICON);
    progressWindow.createLine({ text, progress: 0 });
    progressWindow.show(-1);
    return {
      update(text, percent) {
        progressWindow.changeLine({ text, progress: percent });
      },
      close() {
        progressWindow.close();
      },
    };
  },
};
