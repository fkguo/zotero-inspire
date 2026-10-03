import { config } from "../../package.json";
import type { FluentMessageId } from "../../typings/i10n";

export {
  initLocale,
  getString,
  getLocaleID,
  addMainWindowLabels,
  removeMainWindowLabels,
};

const MAIN_WINDOW_FTL = `${config.addonRef}-mainWindow.ftl`;

/**
 * Initialize locale data
 */
function initLocale() {
  const resourceFiles = [
    `${config.addonRef}-addon.ftl`,
    `${config.addonRef}-preferences.ftl`,
  ];
  const l10n = new (
    typeof Localization === "undefined"
      ? ztoolkit.getGlobal("Localization")
      : Localization
  )(resourceFiles, true);
  addon.data.locale = {
    current: l10n,
  };
}

/**
 * Get locale string, see https://firefox-source-docs.mozilla.org/l10n/fluent/tutorial.html#fluent-translation-list-ftl
 * @param localString ftl key
 * @param options.branch branch name
 * @param options.args args
 * @example
 * ```ftl
 * # addon.ftl
 * addon-static-example = This is default branch!
 *     .branch-example = This is a branch under addon-static-example!
 * addon-dynamic-example =
    { $count ->
        [one] I have { $count } apple
       *[other] I have { $count } apples
    }
 * ```
 * ```js
 * getString("addon-static-example"); // This is default branch!
 * getString("addon-static-example", { branch: "branch-example" }); // This is a branch under addon-static-example!
 * getString("addon-dynamic-example", { args: { count: 1 } }); // I have 1 apple
 * getString("addon-dynamic-example", { args: { count: 2 } }); // I have 2 apples
 * ```
 */
function getString(localString: FluentMessageId): string;
function getString(localString: FluentMessageId, branch: string): string;
function getString(
  localeString: FluentMessageId,
  options: { branch?: string | undefined; args?: Record<string, unknown> },
): string;
function getString(...inputs: any[]) {
  if (inputs.length === 1) {
    return _getString(inputs[0]);
  } else if (inputs.length === 2) {
    if (typeof inputs[1] === "string") {
      return _getString(inputs[0], { branch: inputs[1] });
    } else {
      return _getString(inputs[0], inputs[1]);
    }
  } else {
    throw new Error("Invalid arguments");
  }
}

function _getString(
  localeString: string,
  options: { branch?: string | undefined; args?: Record<string, unknown> } = {},
): string {
  const localStringWithPrefix = `${config.addonRef}-${localeString}`;
  const { branch, args } = options;
  const pattern = addon.data.locale?.current.formatMessagesSync([
    { id: localStringWithPrefix, args },
  ])[0];
  if (!pattern) {
    return localStringWithPrefix;
  }
  if (branch && pattern.attributes) {
    for (const attr of pattern.attributes) {
      if (attr.name === branch) {
        return attr.value;
      }
    }
    return pattern.attributes[branch] || localStringWithPrefix;
  } else {
    return pattern.value || localStringWithPrefix;
  }
}

function getLocaleID(id: string) {
  return `${config.addonRef}-${id}`;
}

/**
 * Load mainWindow.ftl into a main window: the labels of the INSPIRE section
 * of the item pane and of the arXiv browser's menu item and toolbar button
 */
function addMainWindowLabels(win: Window) {
  (win as any).MozXULElement?.insertFTLIfNeeded(MAIN_WINDOW_FTL);
}

/** Remove the labels of mainWindow.ftl from a main window again */
function removeMainWindowLabels(win: Window) {
  win.document
    .querySelector(`link[rel="localization"][href="${MAIN_WINDOW_FTL}"]`)
    ?.remove();
}
