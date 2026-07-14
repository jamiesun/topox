import type { NodeStyle } from "@talkincode/topox-core";

export function utf8ToHex(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function hexToUtf8(value: string): string | undefined {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) return undefined;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Parse a serialized NodeStyle JSON attribute, keeping only known well-typed fields. */
export function parseNodeStyleAttribute(raw: string): NodeStyle | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const source = parsed as Record<string, unknown>;
  const style: NodeStyle = {};
  if (typeof source["fill"] === "string") style.fill = source["fill"];
  if (typeof source["stroke"] === "string") style.stroke = source["stroke"];
  if (typeof source["textColor"] === "string") style.textColor = source["textColor"];
  if (typeof source["fontSize"] === "number") style.fontSize = source["fontSize"];
  if (source["fontWeight"] === "normal" || source["fontWeight"] === "bold") {
    style.fontWeight = source["fontWeight"];
  }
  if (
    source["borderStyle"] === "solid" ||
    source["borderStyle"] === "dashed" ||
    source["borderStyle"] === "dotted"
  ) {
    style.borderStyle = source["borderStyle"];
  }
  return Object.keys(style).length > 0 ? style : undefined;
}
