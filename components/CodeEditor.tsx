"use client";

import { useRef } from "react";

const LINE_HEIGHT = 18;

export function CodeEditor({
  value,
  onChange,
  currentLine,
  errorLines,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  currentLine: number | null;
  errorLines: Set<number>;
  readOnly?: boolean;
}) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const lineCount = value.split("\n").length;
  const lines = Array.from({ length: lineCount }, (_, i) => i + 1);

  const syncScroll = () => {
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  };

  return (
    <div className="editor-wrap">
      <div className="editor-gutter" ref={gutterRef}>
        {lines.map((n) => (
          <div
            key={n}
            className={`editor-gutter-line ${n === currentLine ? "active" : ""}`}
            style={{ height: LINE_HEIGHT }}
          >
            {n}
          </div>
        ))}
      </div>
      <div className="editor-scroll" ref={scrollRef}>
        {currentLine != null && (
          <div
            className="editor-highlight"
            style={{ top: (currentLine - 1) * LINE_HEIGHT + 8 }}
          />
        )}
        {Array.from(errorLines).map((ln) => (
          <div
            key={ln}
            className="editor-error-highlight"
            style={{ top: (ln - 1) * LINE_HEIGHT + 8 }}
          />
        ))}
        <textarea
          ref={taRef}
          className="editor-textarea"
          spellCheck={false}
          value={value}
          readOnly={readOnly}
          onScroll={syncScroll}
          onChange={(e) => onChange(e.target.value)}
          style={{ minHeight: lineCount * LINE_HEIGHT + 16 }}
        />
      </div>
    </div>
  );
}
