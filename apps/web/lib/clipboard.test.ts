import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

describe("copyText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the Clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("hi")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hi");
  });

  it.each([
    ["missing", {}],
    ["refused", { clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) } }],
  ])("falls back to execCommand when the Clipboard API is %s", async (_label, nav) => {
    vi.stubGlobal("navigator", nav);
    const exec = vi.fn(() => true);
    document.execCommand = exec;
    expect(await copyText("hello")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull(); // cleaned up
  });

  it("reports failure when nothing can copy", async () => {
    vi.stubGlobal("navigator", {});
    document.execCommand = vi.fn(() => false);
    expect(await copyText("hello")).toBe(false);
  });
});
