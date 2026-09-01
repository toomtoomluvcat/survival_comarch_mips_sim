"use client";

import { useEffect, useRef } from "react";
import type { AssembleError } from "@/lib/mips/types";

export function ConsolePanel({ text, errors }: { text: string; errors: AssembleError[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text, errors]);

  return (
    <div className="console-body" ref={ref}>
      {errors.length > 0 && (
        <div className="console-errors">
          {errors.map((e, i) => (
            <div key={i}>
              {e.line > 0 ? `Line ${e.line}: ` : ""}
              {e.message}
            </div>
          ))}
        </div>
      )}
      {text}
    </div>
  );
}
