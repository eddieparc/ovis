import { afterEach, beforeEach, expect, it, jest } from "bun:test";
import { PRESENCE_IDLE_MS, watchPageInUse } from "./presence.ts";

/** an event target that records its listeners, so the test can fire them */
function target() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, listener: () => void) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener); },
    removeEventListener(type: string, listener: () => void) { listeners.get(type)?.delete(listener); },
    fire(type: string) { for (const listener of listeners.get(type) ?? []) listener(); },
    count() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

let page: { visibilityState: string; focused: boolean };
let win: ReturnType<typeof target>;
let doc: ReturnType<typeof target> & { visibilityState: string; hasFocus: () => boolean };
const saved = { window: Object.getOwnPropertyDescriptor(globalThis, "window"), document: Object.getOwnPropertyDescriptor(globalThis, "document") };

beforeEach(() => {
  jest.useFakeTimers();
  page = { visibilityState: "visible", focused: true };
  win = target();
  doc = Object.assign(target(), { get visibilityState() { return page.visibilityState; }, hasFocus: () => page.focused });
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
});

afterEach(() => {
  jest.useRealTimers();
  for (const key of ["window", "document"] as const) {
    if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else delete (globalThis as Record<string, unknown>)[key];
  }
});

it("counts a visible, focused page left alone for the idle time as not in use, and in use again at the next input", () => {
  const told: boolean[] = [];
  const stop = watchPageInUse((active) => told.push(active));
  expect(told).toEqual([true]);
  jest.advanceTimersByTime(PRESENCE_IDLE_MS - 1);
  expect(told.at(-1)).toBe(true);
  jest.advanceTimersByTime(1);
  expect(told.at(-1)).toBe(false);
  // focus coming back with no input yet does not undo it: a screen that stays on gets focus events too
  win.fire("focus");
  expect(told.at(-1)).toBe(false);
  win.fire("keydown");
  expect(told.at(-1)).toBe(true);
  stop();
});

it("measures the idle time from the latest input", () => {
  const told: boolean[] = [];
  const stop = watchPageInUse((active) => told.push(active), 1_000);
  jest.advanceTimersByTime(600);
  win.fire("pointermove");
  jest.advanceTimersByTime(600);
  expect(told).toEqual([true]);
  jest.advanceTimersByTime(400);
  expect(told).toEqual([true, false]);
  stop();
});

it("still counts a hidden or unfocused page as not in use however recent the input", () => {
  const told: boolean[] = [];
  const stop = watchPageInUse((active) => told.push(active));
  page.focused = false;
  win.fire("blur");
  page.visibilityState = "hidden";
  doc.fire("visibilitychange");
  expect(told).toEqual([true, false, false]);
  stop();
});

it("removes every listener and its timer when stopped", () => {
  const told: boolean[] = [];
  const stop = watchPageInUse((active) => told.push(active));
  stop();
  expect(win.count() + doc.count()).toBe(0);
  jest.advanceTimersByTime(PRESENCE_IDLE_MS * 2);
  expect(told).toEqual([true]);
});
