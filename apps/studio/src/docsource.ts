import { validateDoc, type TopoDoc } from "@topox/core";

/**
 * Shared-studio protocol. A host app links to the studio with:
 *
 *   /studio/?src=/api/topo/docs/42            load document (GET, JSON TopoDoc)
 *           &save=/api/topo/docs/42           save endpoint (PUT; defaults to src)
 *           &ret=/network/42                  optional "Back" target after editing
 *
 * Relative URLs resolve against the studio origin, so same-domain deployments
 * (studio static files served by the host backend) need no CORS setup and
 * cookies flow automatically (credentials: include).
 */
export interface DocSource {
  src: string;
  save: string;
  ret?: string;
}

export function parseDocSource(search: string): DocSource | null {
  const params = new URLSearchParams(search);
  const src = params.get("src");
  if (!src) return null;
  const ret = params.get("ret");
  return {
    src,
    save: params.get("save") ?? src,
    ...(ret !== null ? { ret } : {}),
  };
}

export async function fetchDoc(url: string): Promise<TopoDoc> {
  const res = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`load failed: HTTP ${res.status}`);
  const parsed: unknown = await res.json();
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("graph" in parsed) ||
    !("views" in parsed)
  ) {
    throw new Error("expected a TopoDoc: { graph, views }");
  }
  const doc = parsed as TopoDoc;
  const problems = validateDoc(doc).filter((i) => i.severity === "error");
  if (problems.length > 0) throw new Error(problems.map((p) => p.message).join("; "));
  return doc;
}

export async function saveDocTo(url: string, doc: TopoDoc): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw new Error(`save failed: HTTP ${res.status}`);
}
