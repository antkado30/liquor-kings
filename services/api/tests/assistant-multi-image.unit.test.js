import { describe, it, expect } from "vitest";
import { buildUserMessageContent } from "../src/lib/assistant.js";

/**
 * Multi-photo assistant (2026-07-17, TONY-WANTS 7/16 #1: "when sending
 * pictures to the AI u should be able to send multiple"). Locks the
 * content-block mapping and the singular back-compat.
 */

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCA',".replace(",", "");
// A minimal-but-valid-shaped data URI (>=64 chars base64 body not required for
// the data-URI branch of parseImageInput — the regex path accepts any body).
const img = (n) => `data:image/jpeg;base64,QUJDX${n}_padding_padding_padding_padding`;

describe("buildUserMessageContent — multi-photo", () => {
  it("maps an array to one image block per photo, text last", () => {
    const content = buildUserMessageContent({
      question: "what are these",
      imageDataUris: [img(1), img(2), img(3)],
    });
    expect(Array.isArray(content)).toBe(true);
    const images = content.filter((b) => b.type === "image");
    const texts = content.filter((b) => b.type === "text");
    expect(images).toHaveLength(3);
    expect(texts).toHaveLength(1);
    expect(content[content.length - 1].type).toBe("text"); // text comes last
    expect(images[0].source.type).toBe("base64");
  });

  it("still accepts the legacy singular imageDataUri", () => {
    const content = buildUserMessageContent({
      question: "",
      imageDataUri: img(9),
    });
    expect(content.filter((b) => b.type === "image")).toHaveLength(1);
  });

  it("merges singular + plural (both present)", () => {
    const content = buildUserMessageContent({
      question: "x",
      imageDataUri: img(0),
      imageDataUris: [img(1), img(2)],
    });
    expect(content.filter((b) => b.type === "image")).toHaveLength(3);
  });

  it("caps at 6 images", () => {
    const content = buildUserMessageContent({
      question: "many",
      imageDataUris: Array.from({ length: 10 }, (_, i) => img(i)),
    });
    expect(content.filter((b) => b.type === "image")).toHaveLength(6);
  });

  it("no images → returns a plain string (unchanged single-turn behavior)", () => {
    const content = buildUserMessageContent({ question: "just text" });
    expect(typeof content).toBe("string");
    expect(content).toBe("just text");
  });

  it("images with no question get a sensible default prompt", () => {
    const content = buildUserMessageContent({ imageDataUris: [img(1), img(2)] });
    const text = content.find((b) => b.type === "text").text;
    expect(text.toLowerCase()).toContain("photos");
  });

  it("drops junk/empty entries without exploding", () => {
    const content = buildUserMessageContent({
      question: "x",
      imageDataUris: [img(1), "", "not-an-image", null, img(2)],
    });
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
  });
});
