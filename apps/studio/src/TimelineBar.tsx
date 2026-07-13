/**
 * DVR-style scrubber over the recorded RuntimeEvent stream.
 * Seeking replays state via RuntimeTimeline.stateAt — the document, layout
 * and edit pipeline are untouched by time travel (runtime is an overlay).
 */
import type { TimelineRange } from "@topox/core";
import type { CSSProperties } from "react";

export interface TimelineBarProps {
  range: TimelineRange;
  /** null = live (following the newest state). */
  replayTs: number | null;
  playing: boolean;
  onSeek: (ts: number) => void;
  onTogglePlay: () => void;
  onLive: () => void;
}

const fmt = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, { hour12: false });

const btn: CSSProperties = {
  border: "1px solid #d0d7de",
  background: "#fff",
  borderRadius: 6,
  padding: "3px 10px",
  fontSize: 12,
  cursor: "pointer",
  lineHeight: "16px",
};

export function TimelineBar({ range, replayTs, playing, onSeek, onTogglePlay, onLive }: TimelineBarProps) {
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
        background: "#ffffffee",
        border: "1px solid #e2e8f0",
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
      <button
        style={{
          ...btn,
          ...(live ? { background: "#16a34a", borderColor: "#16a34a", color: "#fff" } : {}),
        }}
        onClick={onLive}
      >
        Live
      </button>
      <span style={{ color: "#64748b", fontVariantNumeric: "tabular-nums" }}>{fmt(range.start)}</span>
      <input
        type="range"
        min={range.start}
        max={range.end}
        step={100}
        value={value}
        onChange={(e) => onSeek(Number(e.target.value))}
        style={{ flex: 1, accentColor: live ? "#16a34a" : "#2563eb" }}
      />
      <span style={{ color: "#64748b", fontVariantNumeric: "tabular-nums" }}>{fmt(range.end)}</span>
      <span
        style={{
          minWidth: 118,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          color: live ? "#16a34a" : "#2563eb",
        }}
      >
        {live ? "LIVE" : `REPLAY ${fmt(value)}`}
      </span>
    </div>
  );
}
