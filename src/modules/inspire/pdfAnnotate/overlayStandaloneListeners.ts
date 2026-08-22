interface WeakRefLike<T extends object> {
  deref(): T | undefined;
}

export function installStandaloneReaderListeners(
  window: object,
  windowRef: WeakRefLike<object> | undefined,
  onForegroundChange: (foreground: boolean) => void,
): (() => void) | undefined {
  const focus = () => onForegroundChange(true);
  const blur = () => onForegroundChange(false);
  try {
    (window as any).addEventListener("focus", focus);
    (window as any).addEventListener("activate", focus);
    (window as any).addEventListener("blur", blur);
    (window as any).addEventListener("deactivate", blur);
  } catch {
    removeListeners(window, focus, blur);
    return undefined;
  }
  return () => {
    const live = windowRef?.deref();
    if (live) removeListeners(live, focus, blur);
  };
}

function removeListeners(
  window: object,
  focus: () => void,
  blur: () => void,
): void {
  try {
    (window as any).removeEventListener?.("focus", focus);
    (window as any).removeEventListener?.("activate", focus);
    (window as any).removeEventListener?.("blur", blur);
    (window as any).removeEventListener?.("deactivate", blur);
  } catch {
    // A closing standalone window may already have discarded its listeners.
  }
}
