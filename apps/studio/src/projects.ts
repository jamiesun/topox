import { validateDoc, type TopoDoc } from "@topox/core";

/**
 * Local project store. The studio is a static app, so multi-diagram
 * management lives in localStorage: an index of project metadata plus one
 * document entry per project. Shared-studio mode (?src=) bypasses all of
 * this — the host owns that document.
 *
 * Storage is best-effort: when localStorage is unavailable (private mode,
 * sandboxed iframe) every call degrades to a no-op / empty list.
 */
export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
}

const INDEX_KEY = "topox.projects";
const CURRENT_KEY = "topox.projects.current";
const docKey = (id: string): string => `topox.projects.${id}.doc`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage full or unavailable — projects simply don't persist
  }
}

function readIndex(): ProjectMeta[] {
  const raw = read(INDEX_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is ProjectMeta =>
        p !== null &&
        typeof p === "object" &&
        typeof (p as ProjectMeta).id === "string" &&
        typeof (p as ProjectMeta).name === "string" &&
        typeof (p as ProjectMeta).updatedAt === "number",
    );
  } catch {
    return [];
  }
}

function writeIndex(index: ProjectMeta[]): void {
  write(INDEX_KEY, JSON.stringify(index));
}

/** All projects, most recently updated first. */
export function listProjects(): ProjectMeta[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The project auto-opened on startup, when it still exists. */
export function getCurrentProjectId(): string | null {
  const id = read(CURRENT_KEY);
  if (id === null) return null;
  return readIndex().some((p) => p.id === id) ? id : null;
}

export function setCurrentProjectId(id: string | null): void {
  write(CURRENT_KEY, id);
}

/** Parses and validates a stored document; corrupt entries read as null. */
export function loadProjectDoc(id: string): TopoDoc | null {
  const raw = read(docKey(id));
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !("graph" in parsed) ||
      !("views" in parsed)
    )
      return null;
    const doc = parsed as TopoDoc;
    if (validateDoc(doc).some((issue) => issue.severity === "error")) return null;
    return doc;
  } catch {
    return null;
  }
}

export function createProject(name: string, doc: TopoDoc): ProjectMeta {
  const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const meta: ProjectMeta = { id, name, updatedAt: Date.now() };
  writeIndex([...readIndex(), meta]);
  write(docKey(id), JSON.stringify(doc));
  return meta;
}

/** Persists a document; ignored when the project no longer exists. */
export function saveProjectDoc(id: string, doc: TopoDoc): void {
  const index = readIndex();
  const meta = index.find((p) => p.id === id);
  if (!meta) return;
  meta.updatedAt = Date.now();
  writeIndex(index);
  write(docKey(id), JSON.stringify(doc));
}

export function renameProject(id: string, name: string): void {
  const index = readIndex();
  const meta = index.find((p) => p.id === id);
  if (!meta) return;
  meta.name = name;
  meta.updatedAt = Date.now();
  writeIndex(index);
}

export function deleteProject(id: string): void {
  writeIndex(readIndex().filter((p) => p.id !== id));
  write(docKey(id), null);
  if (read(CURRENT_KEY) === id) write(CURRENT_KEY, null);
}
