import { describe, expect, it } from "vitest";
import { colabOrigin, receiveClipMineExport, CLIPMINE_MAX_BYTES } from "./clipmine-transfer";
describe("ClipMine browser transfer", () => {
  const opener = {} as Window;
  function event() {
    const bytes = new ArrayBuffer(32);
    new Uint8Array(bytes).set(new TextEncoder().encode("ftyp"), 4);
    return { origin: "https://abc-123-colab.googleusercontent.com", source: opener,
      data: { type: "clipmine-export-v1", name: "review.mp4", title: "Review", bytes } };
  }
  it("accepts MP4 data only from its Colab opener", () => {
    expect(receiveClipMineExport(event(), opener)?.name).toBe("review.mp4");
    expect(receiveClipMineExport(event(), null)).toBeNull();
    expect(receiveClipMineExport({ ...event(), source: {} as Window }, opener)).toBeNull();
  });
  it("rejects lookalike origins and unrelated data", () => {
    expect(colabOrigin("https://abc-colab.googleusercontent.com.evil.test")).toBe(false);
    expect(colabOrigin("https://evil.test")).toBe(false);
    expect(colabOrigin("null")).toBe(false);
    expect(receiveClipMineExport({ ...event(), origin: "https://evil.test" }, opener)).toBeNull();
    const bad = event(); bad.data.type = "publish";
    expect(receiveClipMineExport(bad, opener)).toBeNull();
  });
  it("rejects oversized and non-MP4 payloads", () => {
    const bad = event(); bad.data.bytes = new ArrayBuffer(CLIPMINE_MAX_BYTES + 1);
    expect(receiveClipMineExport(bad, opener)).toBeNull();
    bad.data.bytes = new ArrayBuffer(32);
    expect(receiveClipMineExport(bad, opener)).toBeNull();
  });
});
