/**
 * TopoX DSL — a line-oriented topology language.
 *
 * This is the contract of the AI boundary: AI (and humans, and scripts) write DSL;
 * the compiler turns it into a GraphDiff against the current document. Nothing
 * mutates the canvas directly.
 *
 *   # comments start with #
 *   node <id> ["label"] [type=net-router] [ref=ros:hq] [tags=a,b] [key=value ...]
 *   edge <src> -> <dst> ["label"] [id=e1] [color=red] [weight=2] [key=value ...]
 *   edge <src> -- <dst>                    # undirected
 *   group <id> ["label"] children=a,b,c
 *   set node <id> key=value ...            # update fields / attrs (null deletes)
 *   set edge <id> key=value ...
 *   remove node <id>                       # connected edges removed automatically
 *   remove edge <id>
 *   remove group <id>
 *
 * `node` upserts: an existing id becomes an update, a new id becomes an add.
 */

export type Token = { text: string; quoted: boolean };

export interface DslError {
  line: number;
  message: string;
  source: string;
}

/** Splits one line into tokens, honoring double quotes with \" escapes. */
export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }
    if (ch === "#") break;
    if (ch === '"') {
      let value = "";
      i += 1;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\" && i + 1 < line.length) {
          value += line[i + 1];
          i += 2;
        } else {
          value += line[i];
          i += 1;
        }
      }
      i += 1; // closing quote
      tokens.push({ text: value, quoted: true });
      continue;
    }
    // bare token, but a key= prefix may be followed by a quoted value: key="a b"
    let value = "";
    while (i < line.length && line[i] !== " " && line[i] !== "\t" && line[i] !== "#") {
      if (line[i] === "=" && line[i + 1] === '"') {
        value += "=";
        i += 2;
        while (i < line.length && line[i] !== '"') {
          if (line[i] === "\\" && i + 1 < line.length) {
            value += line[i + 1];
            i += 2;
          } else {
            value += line[i];
            i += 1;
          }
        }
        i += 1;
        break;
      }
      value += line[i];
      i += 1;
    }
    tokens.push({ text: value, quoted: false });
  }
  return tokens;
}
