import { useState } from "react";
import type { CompileResult } from "@talkincode/topox-dsl";
import type { DiffOp, TopoDoc } from "@talkincode/topox-core";
import { generateDsl, loadLlmConfig, saveLlmConfig, type LlmConfig } from "./ai.js";

export function describeOp(op: DiffOp): { sign: string; color: string; text: string } {
  switch (op.op) {
    case "add_node":
      return { sign: "+", color: "var(--ok)", text: `node ${op.node.id} (${op.node.label})` };
    case "remove_node":
      return { sign: "−", color: "var(--danger)", text: `node ${op.node.id} (${op.node.label})` };
    case "update_node":
      return { sign: "~", color: "var(--warning)", text: `node ${op.id}: ${Object.keys(op.after).join(", ")}` };
    case "add_edge":
      return { sign: "+", color: "var(--ok)", text: `edge ${op.edge.source} → ${op.edge.target}` };
    case "remove_edge":
      return { sign: "−", color: "var(--danger)", text: `edge ${op.edge.source} → ${op.edge.target}` };
    case "update_edge":
      return { sign: "~", color: "var(--warning)", text: `edge ${op.id}: ${Object.keys(op.after).join(", ")}` };
    case "add_group":
      return { sign: "+", color: "var(--ok)", text: `group ${op.group.id}` };
    case "remove_group":
      return { sign: "−", color: "var(--danger)", text: `group ${op.group.id}` };
    case "update_group":
      return { sign: "~", color: "var(--warning)", text: `group ${op.id}` };
    case "update_meta":
      return { sign: "~", color: "var(--warning)", text: "graph meta" };
    case "add_view":
      return { sign: "+", color: "var(--ok)", text: `view ${op.view.id}` };
    case "remove_view":
      return { sign: "−", color: "var(--danger)", text: `view ${op.view.id}` };
    case "set_layout":
      return { sign: "~", color: "var(--muted-2)", text: `layout ${op.nodeId}` };
  }
}

const box = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface)",
  padding: 10,
} as const;

const input = {
  width: "100%",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "5px 8px",
  fontSize: 12.5,
  boxSizing: "border-box" as const,
} as const;

const btn = {
  border: "1px solid var(--border)",
  background: "var(--surface)",
  borderRadius: 6,
  padding: "5px 10px",
  fontSize: 12.5,
  cursor: "pointer",
} as const;

export interface AiPanelProps {
  doc: TopoDoc;
  dsl: string;
  onDslChange: (dsl: string) => void;
  compiled: CompileResult | null;
}

/**
 * The AI boundary made visible: Prompt → DSL → GraphDiff → Preview.
 * The DSL is always shown and editable — AI output is a draft, never a mutation.
 */
export function AiPanel({ doc, dsl, onDslChange, compiled }: AiPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<LlmConfig>(() => loadLlmConfig());

  const runAi = async () => {
    if (prompt.trim() === "" || busy) return;
    setBusy(true);
    setAiError(null);
    try {
      const text = await generateDsl(config, doc, prompt.trim());
      onDslChange(text);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const updateConfig = (patch: Partial<LlmConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveLlmConfig(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 600 }}>Prompt</span>
          <button style={{ ...btn, padding: "2px 8px", fontSize: 11 }} onClick={() => setShowConfig(!showConfig)}>
            {showConfig ? "hide LLM config" : "LLM config"}
          </button>
        </div>
        {showConfig ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            <input
              style={input}
              placeholder="endpoint, e.g. https://api.openai.com/v1"
              value={config.endpoint}
              onChange={(e) => updateConfig({ endpoint: e.target.value })}
            />
            <input
              style={input}
              placeholder="model, e.g. gpt-4o-mini"
              value={config.model}
              onChange={(e) => updateConfig({ model: e.target.value })}
            />
            <input
              style={input}
              type="password"
              placeholder="api key (stored in localStorage)"
              value={config.apiKey}
              onChange={(e) => updateConfig({ apiKey: e.target.value })}
            />
          </div>
        ) : null}
        <textarea
          style={{ ...input, marginTop: 8, resize: "vertical", minHeight: 48, fontFamily: "inherit" }}
          placeholder="创建三个Agent，通过Router连接数据库"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void runAi();
          }}
        />
        <button
          style={{ ...btn, marginTop: 6, width: "100%", background: "var(--inverse-bg)", color: "var(--inverse-text)", borderColor: "var(--inverse-bg)", opacity: busy ? 0.6 : 1 }}
          onClick={() => void runAi()}
          disabled={busy}
        >
          {busy ? "generating…" : "Generate DSL"}
        </button>
        {aiError ? <div style={{ color: "#c53030", marginTop: 6, fontSize: 12 }}>{aiError}</div> : null}
      </div>

      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>DSL (editable)</div>
        <textarea
          style={{ ...input, fontFamily: "ui-monospace, monospace", fontSize: 12, minHeight: 120, resize: "vertical", whiteSpace: "pre" }}
          placeholder={'node r1 "Router" type=net-router\nedge r1 -> db'}
          value={dsl}
          onChange={(e) => onDslChange(e.target.value)}
          spellCheck={false}
        />
        {compiled && compiled.errors.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            {compiled.errors.map((err, i) => (
              <div key={i} style={{ color: "#c53030", fontSize: 12 }}>
                line {err.line}: {err.message}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {compiled && compiled.diff.ops.length > 0 ? (
        <div style={box}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            Proposed diff · {compiled.diff.ops.length} op(s)
          </div>
          <div style={{ maxHeight: 160, overflow: "auto" }}>
            {compiled.diff.ops.map((op, i) => {
              const d = describeOp(op);
              return (
                <div key={i} style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", marginBottom: 2 }}>
                  <span style={{ color: d.color, fontWeight: 700 }}>{d.sign}</span> {d.text}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
