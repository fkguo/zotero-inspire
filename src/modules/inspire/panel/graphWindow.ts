/** Shared chrome for graph views, independent of paper/author data. */
export function createGraphWindow(doc: Document, classPrefix: string) {
  const backdrop = doc.createElement("div");
  backdrop.className = `${classPrefix}-backdrop`;
  backdrop.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box";
  const dialog = doc.createElement("div");
  dialog.className = `${classPrefix}-dialog`;
  dialog.setAttribute("role", "dialog");
  dialog.style.cssText =
    "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1100px,92vw);height:min(720px,82vh);min-width:min(560px,96vw);min-height:min(420px,92vh);max-width:96vw;max-height:92vh;background:var(--material-background,#fff);color:var(--fill-primary,#1e293b);border:1px solid var(--fill-quinary,#d1d5db);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;resize:both";
  let saved: string | undefined;
  return {
    backdrop,
    dialog,
    toggleMaximized() {
      if (saved !== undefined) {
        dialog.style.cssText = saved;
        saved = undefined;
      } else {
        saved = dialog.style.cssText;
        Object.assign(dialog.style, {
          left: "2vw",
          top: "4vh",
          transform: "none",
          width: "96vw",
          height: "92vh",
        });
      }
    },
  };
}

export function makeGraphWindowDraggable(
  doc: Document,
  dialog: HTMLElement,
  header: HTMLElement,
): () => void {
  const win = doc.defaultView;
  let origin: { x: number; y: number; left: number; top: number } | undefined;
  const move = (event: MouseEvent) => {
    if (!origin) return;
    const rect = dialog.getBoundingClientRect();
    const width = doc.documentElement.clientWidth || 800;
    const height = doc.documentElement.clientHeight || 600;
    dialog.style.left = `${Math.max(10, Math.min(origin.left + event.clientX - origin.x, Math.max(10, width - rect.width - 10)))}px`;
    dialog.style.top = `${Math.max(10, Math.min(origin.top + event.clientY - origin.y, Math.max(10, height - rect.height - 10)))}px`;
    dialog.style.transform = "none";
  };
  const end = () => {
    origin = undefined;
    win?.removeEventListener("mousemove", move, true);
    win?.removeEventListener("mouseup", end, true);
  };
  const start = (event: MouseEvent) => {
    if (
      event.button !== 0 ||
      (event.target as Element)?.closest("button,input,textarea,select,a")
    )
      return;
    event.preventDefault();
    const rect = dialog.getBoundingClientRect();
    origin = {
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    win?.addEventListener("mousemove", move, true);
    win?.addEventListener("mouseup", end, true);
  };
  header.addEventListener("mousedown", start);
  return () => {
    end();
    header.removeEventListener("mousedown", start);
  };
}
