import { validateDoc, type TopoDoc } from "@talkincode/topox-core";

/**
 * Shared-studio protocol. A host app links to the studio with:
 *
 *   /studio/?src=/api/topo/docs/42            load document (GET, JSON TopoDoc)
 *           &save=/api/topo/docs/42           save endpoint (PUT; defaults to src)
 *           &ret=/network/42                  optional "Back" target after editing
 *
 * All three URLs must be same-origin http(s) — relative URLs resolve against
 * the studio origin. This keeps CORS-free cookie flow (credentials: include)
 * and blocks query-string injection: a crafted link cannot exfiltrate a
 * document to a foreign save endpoint or navigate to a javascript:/foreign ret.
 * A foreign src disables shared mode; a foreign save falls back to src; a
 * foreign ret is dropped.
 */
export interface DocSource {
  src: string;
  save: string;
  ret?: string;
}

/** Returns `raw` when it resolves to a same-origin http(s) URL, else null. */
function sameOriginUrl(raw: string, base: string): string | null {
  try {
    const baseUrl = new URL(base);
    const url = new URL(raw, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.origin !== baseUrl.origin) return null;
    return raw;
  } catch {
    return null;
  }
}

export function parseDocSource(
  search: string,
  base: string = window.location.href,
): DocSource | null {
  const params = new URLSearchParams(search);
  const rawSrc = params.get("src");
  if (!rawSrc) return null;
  const src = sameOriginUrl(rawSrc, base);
  if (src === null) return null;
  const rawSave = params.get("save");
  const save = rawSave !== null ? (sameOriginUrl(rawSave, base) ?? src) : src;
  const rawRet = params.get("ret");
  const ret = rawRet !== null ? sameOriginUrl(rawRet, base) : null;
  return {
    src,
    save,
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
