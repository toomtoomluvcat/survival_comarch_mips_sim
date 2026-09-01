"use client";

import type { SimState } from "@/lib/useSimulator";

const STATUS_LABEL: Record<SimState["status"], string> = {
  idle: "Not assembled",
  assembled: "Ready",
  running: "Running…",
  halted: "Halted",
  error: "Error",
};

export function Toolbar({
  state,
  onNew,
  onOpen,
  onSave,
  onAssemble,
  onRun,
  onStep,
  onStop,
  onReset,
}: {
  state: SimState;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onAssemble: () => void;
  onRun: () => void;
  onStep: () => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const running = state.status === "running";
  const canStep = (state.status === "assembled" || state.status === "halted") && !running;
  const canRun = !running;

  return (
    <div className="toolbar">
      <button className="mac-btn" onClick={onNew}>New</button>
      <button className="mac-btn" onClick={onOpen}>Open…</button>
      <button className="mac-btn" onClick={onSave}>Save…</button>
      <div className="toolbar-sep" />
      <button className="mac-btn" onClick={onAssemble} disabled={running}>Assemble</button>
      <button className="mac-btn" onClick={onRun} disabled={!canRun} title="Assemble &amp; Run (Ctrl/Cmd+Enter)">
        ▶ Run <span style={{ opacity: 0.6, fontSize: 10 }}>⌃⏎</span>
      </button>
      <button className="mac-btn" onClick={onStep} disabled={!canStep}>⏭ Step</button>
      <button className="mac-btn" onClick={onStop} disabled={!running}>■ Stop</button>
      <button className="mac-btn" onClick={onReset} disabled={state.status === "idle"}>↺ Reset</button>
      <div className={`toolbar-status status-${state.status}`}>{STATUS_LABEL[state.status]}</div>
    </div>
  );
}
