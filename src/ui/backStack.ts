/**
 * Android Back handling. Sheets, dialogs and multi-step screens push a handler;
 * the most recent one gets the first chance to consume Back. MainActivity asks
 * window.__bgHandleBack() and only closes the app when nothing handled it.
 */
type Handler = () => boolean;
const stack: Handler[] = [];
let routeHandler: Handler = () => false;

export function pushBackHandler(handler: Handler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

export function setRouteBackHandler(handler: Handler): void {
  routeHandler = handler;
}

export function handleBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]()) return true;
  }
  return routeHandler();
}

if (typeof window !== 'undefined') {
  (window as unknown as { __bgHandleBack?: () => boolean }).__bgHandleBack = handleBack;
}
