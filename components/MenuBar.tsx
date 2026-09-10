"use client";

import { useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect?: () => void;
}

export interface Menu {
  label: string;
  items: MenuItem[];
}

export function MenuBar({ menus }: { menus: Menu[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenIdx(null);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="menubar" ref={ref}>
      <div className="menubar-apple"></div>
      {menus.map((menu, i) => (
        <div
          key={menu.label}
          className={`menubar-item ${openIdx === i ? "open" : ""}`}
          onClick={() => setOpenIdx(openIdx === i ? null : i)}
          onMouseEnter={() => { if (openIdx !== null) setOpenIdx(i); }}
        >
          {menu.label}
          {openIdx === i && (
            <div className="menu-dropdown">
              {menu.items.map((item, j) => (
                <div key={j}>
                  {item.separatorBefore && <div className="menu-dropdown-sep" />}
                  <div
                    className={`menu-dropdown-item ${item.disabled ? "disabled" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (item.disabled) return;
                      setOpenIdx(null);
                      item.onSelect?.();
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="menubar-title">MIPS Simulator</div>
    </div>
  );
}
