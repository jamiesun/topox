/**
 * YAML interop — full-fidelity TopoDoc serialization.
 *
 * YAML is an alternate wire format for the exact same document shape as JSON:
 * `{ graph, views }`. Nothing is lost in a round-trip.
 */
import type { TopoDoc } from "@topox/core";
import { validateDoc } from "@topox/core";
import { parse, stringify } from "yaml";

export function docToYaml(doc: TopoDoc): string {
  return stringify(doc, { indent: 2, lineWidth: 0 });
}

export function docFromYaml(text: string): TopoDoc {
  const parsed: unknown = parse(text);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("graph" in parsed) ||
    !("views" in parsed)
  ) {
    throw new Error("expected a TopoDoc: { graph, views }");
  }
  const doc = parsed as TopoDoc;
  const errors = validateDoc(doc).filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  return doc;
}
