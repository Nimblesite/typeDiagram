// [WEB-DEBOUNCE-TEST] Debounce coalesces rapid calls.
import { describe, expect, it, vi } from "vitest";
import { debounce } from "../src/debounce.js";

describe("[WEB-DEBOUNCE] debounce", () => {
  it("fires once after quiet period with latest args", async () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const d = debounce((n: number) => {
      spy(n);
    }, 50);
    d(1);
    d(2);
    d(3);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(3);
    vi.useRealTimers();
  });
});
