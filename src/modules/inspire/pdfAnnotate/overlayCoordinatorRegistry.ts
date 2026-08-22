import { OverlayCoordinator } from "./overlayCoordinator";

let coordinator: OverlayCoordinator | undefined;

export function initializeOverlayCoordinator(
  enabledAtStartup: boolean,
): OverlayCoordinator {
  coordinator?.shutdown();
  coordinator = new OverlayCoordinator(enabledAtStartup);
  return coordinator;
}

export function getOverlayCoordinator(): OverlayCoordinator {
  return coordinator || initializeOverlayCoordinator(false);
}

export function shutdownOverlayCoordinator(): void {
  coordinator?.shutdown();
  coordinator = undefined;
}
