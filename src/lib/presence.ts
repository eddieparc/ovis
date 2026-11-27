/**
 * Whether this page is in use: on screen, holding the focus, and touched lately. Every PC
 * connection tells its server (WS `presence`), and while any page is in use the server sends no
 * web push to any device (#751).
 *
 * On screen and focused alone is not enough: a desktop whose display never sleeps keeps a
 * frontmost window visible and focused while the person is away, and their phone then hears
 * nothing. So a page with no pointer, key, wheel or touch input for `PRESENCE_IDLE_MS` counts as
 * left until the next input.
 */

/** how long a page on screen goes without input before it counts as left */
export const PRESENCE_IDLE_MS = 3 * 60_000;

/** input that says someone is at this page; listened to in the capture phase, so the terminal's own handlers cannot hide it */
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

/** on screen and holding the focus, the same test PaneTerminal's `inUse` makes */
export function pageInUse(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
}

/**
 * Calls `listener` with whether the page is in use now, and again whenever focus or visibility
 * changes, the page goes `idleMs` without input, or input comes back after that.
 */
export function watchPageInUse(listener: (active: boolean) => void, idleMs: number = PRESENCE_IDLE_MS): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  let lastInput = Date.now();
  let idle = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const update = (): void => listener(!idle && pageInUse());
  // one timer for the idle deadline: input only moves the time it measures from
  const check = (): void => {
    timer = null;
    const left = idleMs - (Date.now() - lastInput);
    if (left > 0) { timer = setTimeout(check, left); return; }
    idle = true;
    update();
  };
  const arm = (): void => {
    if (timer === null) timer = setTimeout(check, Math.max(0, idleMs - (Date.now() - lastInput)));
  };
  const active = (): void => {
    lastInput = Date.now();
    if (idle) { idle = false; update(); }
    arm();
  };
  update();
  arm();
  window.addEventListener("focus", update);
  window.addEventListener("blur", update);
  window.addEventListener("pagehide", update);
  document.addEventListener("visibilitychange", update);
  for (const type of ACTIVITY_EVENTS) window.addEventListener(type, active, { capture: true, passive: true });
  return () => {
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("focus", update);
    window.removeEventListener("blur", update);
    window.removeEventListener("pagehide", update);
    document.removeEventListener("visibilitychange", update);
    for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, active, { capture: true });
  };
}
