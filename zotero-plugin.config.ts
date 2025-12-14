import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: "build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://raw.githubusercontent.com/{{owner}}/{{repo}}/main/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
    // Type generation for Fluent messages (v0.6.0+)
    fluent: {
      dts: "typings/i10n.d.ts",
    },
    // Type generation for preferences (v0.6.0+)
    prefs: {
      dts: "typings/prefs.d.ts",
    },
  },

  // Development server configuration (v0.8.x)
  server: {
    devtools: true,
    // Exclude test files and docs from triggering rebuilds
    watchIgnore: ["**/test/**", "**/*.test.ts", "**/localdocs/**", "**/tmp/**"],
  },

  // Release configuration (v0.7.0+)
  release: {
    bumpp: {
      release: "prompt",
      commit: "chore: release v%s",
      tag: "v%s",
      execute: "npm run build",
    },
    // Auto-generate conventional changelog when commits follow convention
    changelog: "",
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
