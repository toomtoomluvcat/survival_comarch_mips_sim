"use client";

import { useState } from "react";
import type { WaitingInput } from "@/lib/useSimulator";

export function InputModal({
  waiting,
  onSubmitInt,
  onSubmitString,
}: {
  waiting: WaitingInput;
  onSubmitInt: (v: number) => void;
  onSubmitString: (v: string) => void;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    if (waiting.type === "int") {
      const n = parseInt(value, 10);
      onSubmitInt(Number.isNaN(n) ? 0 : n);
    } else {
      onSubmitString(value);
    }
    setValue("");
  };

  return (
    <div className="mac-modal-overlay">
      <div className="mac-modal">
        <div className="mac-titlebar">
          <div className="mac-close-box" />
          <div className="mac-titlebar-title">Program Input</div>
          <div className="mac-titlebar-spacer" />
        </div>
        <div className="mac-modal-body">
          <div>
            {waiting.type === "int"
              ? "The program is requesting an integer (syscall read_int):"
              : `The program is requesting a string (syscall read_string, max ${waiting.maxLen} chars):`}
          </div>
          <input
            autoFocus
            type={waiting.type === "int" ? "number" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
        </div>
        <div className="mac-modal-actions">
          <button className="mac-btn primary" onClick={submit}>OK</button>
        </div>
      </div>
    </div>
  );
}
