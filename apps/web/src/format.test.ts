import { describe, expect, it } from "vitest";
import { formatDuration, statusLabel } from "./format";

describe("formatDuration", () => {
  it("formats seconds as creator-friendly minutes", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(0)).toBe("0:00");
  });

  it("handles missing durations", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("statusLabel", () => {
  it("formats machine status values", () => {
    expect(statusLabel("timeline_fallback")).toBe("Timeline Fallback");
  });
});

