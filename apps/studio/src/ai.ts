import type { TopoDoc } from "@topox/core";
import { docToDsl, DSL_GUIDE } from "@topox/dsl";

export interface LlmConfig {
  endpoint: string;
  model: string;
  apiKey: string;
}

const STORAGE_KEY = "topox.llm";

export function loadLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { endpoint: "", model: "", apiKey: "", ...(JSON.parse(raw) as Partial<LlmConfig>) };
  } catch {
    // fall through
  }
  return { endpoint: "http://localhost:11434/v1", model: "", apiKey: "" };
}

export function saveLlmConfig(config: LlmConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/** Strips markdown fences an LLM may wrap around the DSL. */
export function extractDsl(text: string): string {
  const fenced = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  return (fenced ? fenced[1]! : text).trim();
}

export function buildSystemPrompt(doc: TopoDoc): string {
  const current = docToDsl(doc);
  return `You edit a network topology by emitting TopoX DSL statements.

${DSL_GUIDE}

Current topology:
${current === "" ? "(empty)" : current}

Answer with DSL statements only.`;
}

/** Calls any OpenAI-compatible chat completions endpoint. */
export async function generateDsl(
  config: LlmConfig,
  doc: TopoDoc,
  prompt: string,
): Promise<string> {
  const url = `${config.endpoint.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: buildSystemPrompt(doc) },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    }),
  });
  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content");
  return extractDsl(content);
}
