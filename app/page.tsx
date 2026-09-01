"use client";

import { useRef, useState } from "react";
import { MenuBar, type Menu } from "@/components/MenuBar";
import { MacWindow } from "@/components/MacWindow";
import { CodeEditor } from "@/components/CodeEditor";
import { RegistersPanel } from "@/components/RegistersPanel";
import { MemoryPanel } from "@/components/MemoryPanel";
import { ConsolePanel } from "@/components/ConsolePanel";
import { Toolbar } from "@/components/Toolbar";
import { InputModal } from "@/components/InputModal";
import { useSimulator } from "@/lib/useSimulator";
import { SAMPLE_PROGRAM } from "@/lib/sample";

export default function Home() {
  const [source, setSource] = useState(SAMPLE_PROGRAM);
  const [fileName, setFileName] = useState("untitled.asm");
  const [prevRegisters, setPrevRegisters] = useState<number[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastRegsRef = useRef<number[] | null>(null);

  const {
    state,
    assembleProgram,
    step,
    run,
    stop,
    reset,
    submitIntInput,
    submitStringInput,
    readMemory,
  } = useSimulator();

  const doAssemble = () => {
    lastRegsRef.current = null;
    setPrevRegisters(null);
    assembleProgram(source);
  };

  const wrappedStep = () => {
    lastRegsRef.current = state.registers;
    setPrevRegisters(state.registers);
    step();
  };

  const handleNew = () => {
    if (!confirm("Discard current code and start a new file?")) return;
    setSource("");
    setFileName("untitled.asm");
  };

  const handleOpenClick = () => fileInputRef.current?.click();

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSource(String(reader.result ?? ""));
      setFileName(file.name);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSave = () => {
    const blob = new Blob([source], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "program.asm";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "New", shortcut: "⌘N", onSelect: handleNew },
        { label: "Open…", shortcut: "⌘O", onSelect: handleOpenClick },
        { label: "Save As…", shortcut: "⌘S", onSelect: handleSave },
      ],
    },
    {
      label: "Run",
      items: [
        { label: "Assemble", shortcut: "⌘K", onSelect: doAssemble },
        { label: "Run", shortcut: "⌘R", disabled: state.status !== "assembled", onSelect: run },
        { label: "Step", shortcut: "⌘.", disabled: !(state.status === "assembled" || state.status === "halted"), onSelect: wrappedStep },
        { label: "Stop", disabled: state.status !== "running", onSelect: stop },
        { label: "Reset", separatorBefore: true, disabled: state.status === "idle", onSelect: reset },
      ],
    },
    {
      label: "Help",
      items: [
        {
          label: "About MIPS Simulator",
          onSelect: () => alert("MIPS Simulator\nA classic-styled MIPS assembly IDE.\nSupports the common MIPS32 instruction subset."),
        },
      ],
    },
  ];

  const errorLines = new Set(state.errors.filter((e) => e.line > 0).map((e) => e.line));

  return (
    <>
      <MenuBar menus={menus} />
      <input
        ref={fileInputRef}
        type="file"
        accept=".asm,.s,.txt,.mips"
        style={{ display: "none" }}
        onChange={handleFileSelected}
      />
      <div className="desktop">
        <div className="desktop-editor-col">
          <Toolbar
            state={state}
            onNew={handleNew}
            onOpen={handleOpenClick}
            onSave={handleSave}
            onAssemble={doAssemble}
            onRun={run}
            onStep={wrappedStep}
            onStop={stop}
            onReset={reset}
          />
          <MacWindow title={fileName} style={{ flex: 1, minHeight: 0 }} noScroll>
            <CodeEditor
              value={source}
              onChange={setSource}
              currentLine={state.status === "error" || state.status === "idle" ? null : state.currentLine}
              errorLines={errorLines}
            />
          </MacWindow>
        </div>

        <div className="desktop-side-col">
          <MacWindow title="Registers" style={{ flex: "1 1 40%", minHeight: 0 }}>
            <RegistersPanel
              registers={state.registers}
              pc={state.pc}
              hi={state.hi}
              lo={state.lo}
              prevRegisters={prevRegisters}
            />
          </MacWindow>
          <MacWindow title="Memory" style={{ flex: "1 1 30%", minHeight: 0 }}>
            <MemoryPanel readMemory={readMemory} version={state.memoryVersion} />
          </MacWindow>
          <MacWindow title="Console" style={{ flex: "1 1 30%", minHeight: 0 }}>
            <ConsolePanel text={state.consoleText} errors={state.status === "error" ? state.errors : []} />
          </MacWindow>
        </div>
      </div>

      {state.waitingInput && (
        <InputModal
          waiting={state.waitingInput}
          onSubmitInt={submitIntInput}
          onSubmitString={submitStringInput}
        />
      )}
    </>
  );
}
