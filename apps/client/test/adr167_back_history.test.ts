import { describe, expect, it } from "vitest";
import { BackHistory } from "../src/back-history.js";

/** Minimal async history: back() pops on a later microtask like the browser does. */
function fakeWin() {
  const stack: unknown[] = [null]; let i = 0; const ls: (() => void)[] = []; let backs = 0;
  const history = {
    get state() { return stack[i]; },
    pushState(s: unknown) { stack.length = i + 1; stack.push(s); i++; },
    back() { backs++; queueMicrotask(() => { if (i === 0) { i = -1; return; } i--; ls.forEach((f) => f()); }); },
  };
  const win = { history, addEventListener: (_: string, f: () => void) => ls.push(f), removeEventListener() {} } as unknown as Window;
  return { win, idx: () => i, len: () => stack.length, backs: () => backs, userBack: () => history.back() };
}

describe("ADR-167 BackHistory never navigates off the app", () => {
  it("rapid close/reopen (party Accept/Decline) leaves at most one sentinel and never calls back()", async () => {
    const f = fakeWin(); let closed = 0; const b = new BackHistory(() => closed++, f.win);
    for (let k = 0; k < 20; k++) { b.sync(true); b.sync(false); b.sync(true); }
    await Promise.resolve(); await Promise.resolve();
    expect(f.backs()).toBe(0); expect(f.len()).toBe(2); expect(f.idx()).toBe(1);
    f.userBack(); await Promise.resolve(); expect(closed).toBe(1); expect(f.idx()).toBe(0); // Back still closes the menu
    b.sync(false); b.sync(true); expect(f.len()).toBe(2); // re-armed with a fresh sentinel
  });
});
