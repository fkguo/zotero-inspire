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

export async function promptGraphSaveFile(
  defaultFilename: string,
  title: string,
  filters: Array<{ label: string; pattern: string }>,
): Promise<string | null> {
  const win = Zotero.getMainWindow() as Window & {
    FilePicker?: new () => SavePicker;
  };
  if (!win?.FilePicker) throw new Error("File picker unavailable");
  const picker = new win.FilePicker();
  picker.init(win, title, picker.modeSave);
  for (const filter of filters)
    picker.appendFilter(filter.label, filter.pattern);
  picker.appendFilters(picker.filterAll);
  picker.defaultString = defaultFilename;
  const result = await picker.show();
  return result === picker.returnOK || result === picker.returnReplace
    ? picker.file
    : null;
}

export async function saveGraphPNG(
  doc: Document,
  filePath: string,
  picture: { svg: string; width: number; height: number },
): Promise<void> {
  const { svg, width, height } = picture;
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
    await IOUtils.write(filePath, new Uint8Array(await blob.arrayBuffer()));
  } finally {
    img.onload = img.onerror = null;
    img.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}
