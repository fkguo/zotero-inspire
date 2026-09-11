import { getString } from "../../../utils/locale";
import type { AcademicTreeGraph } from "../academicTreeTypes";
import {
  academicTreeCSV,
  type AcademicTreeViewState,
} from "../academicTreeExploration";
import { AcademicTreeCanvas } from "./AcademicTreeCanvas";

interface SavePicker {
  modeSave: number;
  returnOK: number;
  returnReplace: number;
  filterAll: number;
  defaultString: string;
  file: string;
  init(win: Window, title: string, mode: number): void;
  appendFilter(label: string, pattern: string): void;
  appendFilters(filters: number): void;
  show(): Promise<number>;
}

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
  else if (full) {
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
      temporary.render(graph);
      picture = temporary.exportSVG(true);
    } finally {
      temporary.dispose();
    }
  } else picture = canvas.exportSVG(false);
  const win = Zotero.getMainWindow() as Window & {
    FilePicker?: new () => SavePicker;
  };
  if (!win?.FilePicker) throw new Error("File picker unavailable");
  const picker = new win.FilePicker();
  picker.init(win, getString("academic-tree-export"), picker.modeSave);
  picker.appendFilter(format.toUpperCase(), `*.${format}`);
  picker.appendFilters(picker.filterAll);
  picker.defaultString = `academic-tree-${graph.rootId}.${format}`;
  const result = await picker.show();
  if (result !== picker.returnOK && result !== picker.returnReplace)
    return false;
  if (format !== "png") {
    await Zotero.File.putContentsAsync(picker.file, picture?.svg || contents);
    return true;
  }
  const { svg, width, height } = picture!;
  // Bound raster memory for broad trees; SVG remains resolution-independent.
  const scale = Math.min(
    2,
    8192 / width,
    8192 / height,
    Math.sqrt(16_000_000 / (width * height)),
  );
  const pngWidth = Math.max(1, Math.floor(width * scale));
  const pngHeight = Math.max(1, Math.floor(height * scale));
  const imageDocument = new DOMParser().parseFromString(svg, "image/svg+xml");
  imageDocument.documentElement.setAttribute("width", String(pngWidth));
  imageDocument.documentElement.setAttribute("height", String(pngHeight));
  const rasterSVG = new XMLSerializer().serializeToString(imageDocument);
  const url = URL.createObjectURL(
    new Blob([rasterSVG], { type: "image/svg+xml;charset=utf-8" }),
  );
  const img = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "img",
  ) as HTMLImageElement;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Image load timeout")),
        15000,
      );
      img.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error("SVG decode failed"));
      };
      img.src = url;
    });
    const raster = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    ) as HTMLCanvasElement;
    raster.width = pngWidth;
    raster.height = pngHeight;
    const context = raster.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.drawImage(img, 0, 0, raster.width, raster.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      raster.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error("PNG encode failed")),
        "image/png",
      ),
    );
    await IOUtils.write(picker.file, new Uint8Array(await blob.arrayBuffer()));
    return true;
  } finally {
    img.onload = img.onerror = null;
    img.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}
