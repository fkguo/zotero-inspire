import { ColumnOptions, DialogHelper } from "zotero-plugin-toolkit";
import {config} from "../package.json"
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: "development" | "production";
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    prefs?: {
      window: Window;
    };
    dialog?: DialogHelper;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;

  constructor() {
    let ztoolkit: ZToolkit;
    try {
      ztoolkit = createZToolkit();
    } catch (e) {
      Zotero.logError(e as Error);
      // Fallback or partial initialization if needed, 
      // though usually createZToolkit is essential.
      // We log it so it doesn't crash the whole Addon constructor.
    }
    
    this.data = {
      alive: true,
      config,
      env: __env__,
      ztoolkit: ztoolkit!,
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
