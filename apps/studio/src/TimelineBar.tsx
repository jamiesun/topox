/**
 * DVR-style scrubber over the recorded RuntimeEvent stream.
 * Seeking replays state via RuntimeTimeline.stateAt — the document, layout
 * and edit pipeline are untouched by time travel (runtime is an overlay).
 */
import type { TimelineRange } from "@talkincode/topox-core";
import type { CSSProperties } from "react";

export interface TimelineBarProps {
  range: TimelineRange;
  /** null = live (following the newest state). */
  replayTs: number | null;
  playing: boolean;
  canStepBack: boolean;
  canStepForward: boolean;
  onSeek: (ts: number) => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onTogglePlay: () => void;
  onLive: () => void;
}

const fmt = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, { hour12: false });

const btn: CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--surface)",
  borderRadius: 6,
  padding: "3px 10px",
  fontSize: 12,
  cursor: "pointer",
  lineHeight: "16px",
};

export function TimelineBar({
  range,
  replayTs,
  playing,
  canStepBack,
  canStepForward,
  onSeek,
  onStepBack,
  onStepForward,
  onTogglePlay,
  onLive,
}: TimelineBarProps) {
  const live = replayTs === null;
  const value = replayTs ?? range.end;
  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--surface)", opacity: 0.97,
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "8px 12px",
        boxShadow: "0 4px 14px rgba(15,23,42,.08)",
        fontSize: 12,
        zIndex: 5,
      }}
    >
      <button style={btn} onClick={onTogglePlay} title={playing ? "Pause" : "Replay from here"}>
        {playing ? "⏸" : "▶"}
      </button>
      <button style={btn} onClick={onStepBack} disabled={!canStepBack} title="Previous event">
        ◀|
      </button>
      <button style={btn} onClick={onStepForward} disabled={!canStepForward} title="Next event">
        |▶
      </button>
      <button
        style={{
          ...btn,
          ...(live ? { background: "var(--ok)", borderColor: "var(--ok)", color: "var(--inverse-text)" } : {}),
        }}
        onClick={onLive}
      >
        Live
      </button>
      <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fmt(range.start)}</span>
      <input
        type="range"
        min={range.start}
        max={range.end}
        step={100}
        value={value}
        onChange={(e) => onSeek(Number(e.target.value))}
        style={{ flex: 1, accentColor: live ? "var(--ok)" : "var(--accent)" }}
      />
      <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fmt(range.end)}</span>
      <span
        style={{
          minWidth: 118,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          color: live ? "var(--ok)" : "var(--accent)",
        }}
      >
        {live ? "LIVE" : `REPLAY ${fmt(value)}`}
      </span>
    </div>
  );
}
