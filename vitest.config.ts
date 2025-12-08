import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/modules/inspire/**/*.ts"],
      exclude: [
        "src/modules/inspire/pdfAnnotate/readerIntegration.ts", // DOM-heavy
        "src/modules/inspire/panel/**/*.ts", // UI components
        "src/modules/inspire/menu.ts", // Zotero UI
        "src/modules/inspire/localCache.ts", // File system
      ],
    },
  },
});
