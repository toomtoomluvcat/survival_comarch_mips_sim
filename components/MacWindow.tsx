"use client";

import { ReactNode } from "react";

export function MacWindow({
  title,
  children,
  style,
  bodyClassName,
  noScroll,
}: {
  title: string;
  children: ReactNode;
  style?: React.CSSProperties;
  bodyClassName?: string;
  noScroll?: boolean;
}) {
  return (
    <div className="mac-window" style={style}>
      <div className="mac-titlebar">
        <div className="mac-close-box" />
        <div className="mac-titlebar-title">{title}</div>
        <div className="mac-titlebar-spacer" />
      </div>
      <div className={`mac-window-body ${noScroll ? "no-scroll" : ""} ${bodyClassName ?? ""}`}>
        {children}
      </div>
    </div>
  );
}
