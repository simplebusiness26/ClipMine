import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { parseBatchArchive } from "./batch-zip";

const little16 = (value: number) => [value & 255, (value >>> 8) & 255];
const little32 = (value: number) => [...little16(value), ...little16(value >>> 16)];
function archive(
  entries: { name: string; content: Uint8Array | string; deflate?: boolean; declaredSize?: number }[],
): File {
  const blocks: number[] = [], directory: number[] = [];
  const utf8 = new TextEncoder();
  for (const entry of entries) {
    const name = utf8.encode(entry.name);
    const raw = typeof entry.content === "string" ? utf8.encode(entry.content) : entry.content;
    const compressed = entry.deflate ? deflateRawSync(raw) : raw;
    const method = entry.deflate ? 8 : 0;
    const offset = blocks.length;
    const size = entry.declaredSize ?? raw.length;
    blocks.push(
      ...little32(0x04034b50), ...little16(20), ...little16(0), ...little16(method),
      ...little32(0), ...little32(0), ...little32(compressed.length), ...little32(size),
      ...little16(name.length), ...little16(0), ...name, ...compressed,
    );
    directory.push(
      ...little32(0x02014b50), ...little16(20), ...little16(20), ...little16(0),
      ...little16(method), ...little32(0), ...little32(0), ...little32(compressed.length),
      ...little32(size), ...little16(name.length), ...little16(0), ...little16(0),
      ...little16(0), ...little16(0), ...little32(0), ...little32(offset), ...name,
    );
  }
  const start = blocks.length;
  const bytes = new Uint8Array([
    ...blocks, ...directory, ...little32(0x06054b50), ...little16(0),
    ...little16(0), ...little16(entries.length), ...little16(entries.length),
    ...little32(directory.length), ...little32(start), ...little16(0),
  ]);
  return new File([bytes], "pack.zip", { type: "application/zip" });
}
const tinyPng = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
describe("bounded content ZIP import", () => {
  it("matches JSON metadata with files in folders and captures hashtags", async () => {
    const file = archive([
      { name: "media/clip-01.png", content: tinyPng },
      { name: "metadata.json", content: JSON.stringify({ posts: [{
        filename: "clip-01.png", title: "A real title",
        description: "A sample caption", hashtags: ["#adhd", "#cartoon"],
      }] }) },
    ]);
    const result = await parseBatchArchive(file);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("A real title");
    expect(result[0].caption).toBe("A sample caption\n\n#adhd #cartoon");
    expect(result[0].file.type).toBe("image/png");
    expect(new Uint8Array(await result[0].file.arrayBuffer())).toEqual(tinyPng);
  });
  it("reads compressed TXT sidecars and quotes in caption CSVs", async () => {
    const text = await parseBatchArchive(archive([
      { name: "one.png", content: tinyPng },
      { name: "one.txt", content: "From a text sidecar", deflate: true },
    ]));
    expect(text[0].caption).toBe("From a text sidecar");
    const csv = await parseBatchArchive(archive([
      { name: "two.png", content: tinyPng },
      { name: "captions.csv", content: 'filename,title,caption\ntwo.png,"Quote, test","Hello, world"' },
    ]));
    expect(csv[0].title).toBe("Quote, test");
    expect(csv[0].caption).toBe("Hello, world");
  });
  it("fails closed for duplicates, directory traversal, oversized files and invalid archives", async () => {
    await expect(parseBatchArchive(archive([
      { name: "x.png", content: tinyPng }, { name: "folder/x.png", content: tinyPng },
    ]))).rejects.toThrow(/duplicate/i);
    await expect(parseBatchArchive(archive([
      { name: "../evil.png", content: tinyPng },
    ]))).rejects.toThrow(/unsafe/i);
    await expect(parseBatchArchive(archive([
      { name: "big.png", content: tinyPng, declaredSize: 26 * 1024 * 1024 },
    ]))).rejects.toThrow(/size limit/i);
    await expect(parseBatchArchive(new File([new Uint8Array(32)], "bad.zip")))
      .rejects.toThrow(/supported ZIP/i);
  });
  it("rejects archives with more than 20 supported media files", async () => {
    const items = Array.from({ length: 21 }, (_, i) =>
      ({ name: i + ".png", content: tinyPng }));
    await expect(parseBatchArchive(archive(items))).rejects.toThrow(/20 media/i);
  });
});
