"use client";

import { useState } from "react";
import { REGISTER_NAMES } from "@/lib/mips/registers";

function fmt(v: number, hex: boolean): string {
  if (hex) return "0x" + (v >>> 0).toString(16).padStart(8, "0");
  return String(v);
}

export function RegistersPanel({
  registers,
  pc,
  hi,
  lo,
  prevRegisters,
}: {
  registers: number[];
  pc: number;
  hi: number;
  lo: number;
  prevRegisters: number[] | null;
}) {
  const [hex, setHex] = useState(true);

  return (
    <div>
      <div className="reg-special">
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={hex} onChange={(e) => setHex(e.target.checked)} />
          hex
        </label>
      </div>
      <div className="reg-special">
        <span>PC {fmt(pc, true)}</span>
        <span>HI {fmt(hi, hex)}</span>
        <span>LO {fmt(lo, hex)}</span>
      </div>
      <table className="reg-table">
        <tbody>
          {registers.map((v, i) => {
            const changed = prevRegisters != null && prevRegisters[i] !== v;
            return (
              <tr key={i} className={`reg-row ${changed ? "changed" : ""}`}>
                <td className="reg-name">${i} ({REGISTER_NAMES[i]})</td>
                <td className="reg-value">{fmt(v, hex)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
