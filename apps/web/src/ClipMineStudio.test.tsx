import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ClipMineImport from "./ClipMineImport";
import ClipMineStudio from "./ClipMineStudio";

describe("ClipMine in Niches", () => {
  it("allows a creator to launch the Phone Studio before picking a niche", () => {
    const page = renderToStaticMarkup(<ClipMineStudio niches={[]} changed={() => {}} />);

    expect(page).toContain("Open Phone Studio");
    expect(page).toContain('href="https://colab.research.google.com/drive/1FQatg88WooJV2YI7TUwtZjCwzTgqoZbb"');
    expect(page).toContain('target="_blank" rel="noopener noreferrer"');
    expect(page).toContain("Save to Niches");
    expect(page).not.toContain("Select a niche");
  });

  it("shows a waiting state without a save action until a clip is received", () => {
    const page = renderToStaticMarkup(<ClipMineImport niches={[]} />);

    expect(page).toContain('role="status"');
    expect(page).toContain("Waiting for your clip");
    expect(page).not.toContain("Save Instagram draft");
  });
});
