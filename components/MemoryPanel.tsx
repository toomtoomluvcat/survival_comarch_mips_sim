"use client";

import { useState } from "react";
import { DATA_BASE } from "@/lib/mips/memory";

export function MemoryPanel({
  readMemory,
  version,
}: {
  readMemory: (addr: number, count: number) => number[];
  version: number;
}) {
  const [addrText, setAddrText] = useState("0x" + DATA_BASE.toString(16));
  const rows = 12;
  const bytesPerRow = 8;

  let base = parseInt(addrText, 16);
  if (Number.isNaN(base)) base = DATA_BASE;
  base = base - (base % 4);

  const bytes = readMemory(base, rows * bytesPerRow);

  return (
    <div>
      <div className="mem-controls">
        <span>addr</span>
        <input
          value={addrText}
          onChange={(e) => setAddrText(e.target.value)}
          spellCheck={false}
        />
        <button className="mac-btn" onClick={() => setAddrText("0x" + DATA_BASE.toString(16))}>
          .data
        </button>
      </div>
      <table className="mem-table">
        <tbody key={version}>
          {Array.from({ length: rows }, (_, r) => {
            const rowAddr = base + r * bytesPerRow;
            const rowBytes = bytes.slice(r * bytesPerRow, r * bytesPerRow + bytesPerRow);
            const ascii = rowBytes
              .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
              .join("");
            return (
              <tr key={r}>
                <td className="mem-addr">0x{(rowAddr >>> 0).toString(16).padStart(8, "0")}</td>
                {rowBytes.map((b, i) => (
                  <td className="mem-byte" key={i}>
                    {b.toString(16).padStart(2, "0")}
                  </td>
                ))}
                <td className="mem-ascii">{ascii}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
