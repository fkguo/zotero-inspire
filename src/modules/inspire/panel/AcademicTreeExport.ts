import { promptGraphSaveFile, saveGraphPNG } from "./graphFileIO";
import { getString } from "../../../utils/locale";
import type { AcademicTreeGraph } from "../academicTreeTypes";
import {
  academicTreeCSV,
  type AcademicTreeViewState,
} from "../academicTreeExploration";
import { AcademicTreeCanvas } from "./AcademicTreeCanvas";

export async function exportAcademicTree(
  doc: Document,
  graph: AcademicTreeGraph,
  canvas: AcademicTreeCanvas,
  state: AcademicTreeViewState,
  settings: Record<string, unknown>,
  format: "svg" | "png" | "json" | "csv",
  full: boolean,
): Promise<boolean> {
  // Capture the selected scope before opening the asynchronous native picker.
  let picture: ReturnType<AcademicTreeCanvas["exportSVG"]> | undefined;
  let contents = "";
  if (format === "json")
    contents = JSON.stringify(
      {
        schemaVersion: 1,
        source: "https://inspirehep.net",
        exportedAt: new Date().toISOString(),
        scope: full ? "full-loaded-tree" : "visible-tree",
        graph,
        view: state,
        settings,
        viewport: canvas.captureViewport(),
      },
      null,
      2,
    );
  else if (format === "csv") contents = academicTreeCSV(graph);
  else {
    // The on-screen canvas is only a viewport. Render the selected graph in an
    // off-screen canvas so Current view also includes shown people beyond it.
    const temporary = new AcademicTreeCanvas(
      doc,
      "",
      () => {},
      () => {},
      (node) => node.name,
      () => {},
      () => {},
    );
    try {
      temporary.render(
        graph,
        undefined,
        undefined,
        state.sort || "name",
        !!state.fitPage,
        canvas.layoutPageWidth || undefined,
      );
      picture = temporary.exportSVG(true);
    } finally {
      temporary.dispose();
    }
  }
  const filePath = await promptGraphSaveFile(
    `academic-tree-${graph.rootId}.${format}`,
    getString("academic-tree-export"),
    [{ label: format.toUpperCase(), pattern: `*.${format}` }],
  );
  if (!filePath) return false;
  if (format === "png") await saveGraphPNG(doc, filePath, picture!);
  else await Zotero.File.putContentsAsync(filePath, picture?.svg || contents);
  return true;
}
