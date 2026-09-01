"use client";

import { useCallback, useRef, useState } from "react";
import { assemble, buildInitialMemory, CPU, Memory } from "./mips";
import type { AssembledProgram } from "./mips/assembler";
import type { AssembleError, SyscallKind } from "./mips/types";

export type WaitingInput = { type: "int" } | { type: "string"; maxLen: number; addr: number };

export interface SimState {
  status: "idle" | "assembled" | "running" | "halted" | "error";
  errors: AssembleError[];
  registers: number[];
  pc: number;
  hi: number;
  lo: number;
  consoleText: string;
  currentLine: number | null;
  waitingInput: WaitingInput | null;
  memoryVersion: number;
}

const INITIAL: SimState = {
  status: "idle",
  errors: [],
  registers: new Array(32).fill(0),
  pc: 0,
  hi: 0,
  lo: 0,
  consoleText: "",
  currentLine: null,
  waitingInput: null,
  memoryVersion: 0,
};

const MAX_STEPS_PER_CHUNK = 20000;
const MAX_TOTAL_STEPS = 5_000_000;

export function useSimulator() {
  const [state, setState] = useState<SimState>(INITIAL);
  const cpuRef = useRef<CPU | null>(null);
  const memRef = useRef<Memory | null>(null);
  const programRef = useRef<AssembledProgram | null>(null);
  const stopFlag = useRef(false);
  const totalSteps = useRef(0);

  const snapshot = useCallback((extra: Partial<SimState> = {}) => {
    const cpu = cpuRef.current;
    setState((s) => ({
      ...s,
      registers: cpu ? Array.from(cpu.regs) : s.registers,
      pc: cpu ? cpu.pc : s.pc,
      hi: cpu ? cpu.hi : s.hi,
      lo: cpu ? cpu.lo : s.lo,
      currentLine: cpu ? cpu.currentLine() ?? null : s.currentLine,
      memoryVersion: s.memoryVersion + 1,
      ...extra,
    }));
  }, []);

  const appendConsole = (text: string) => {
    setState((s) => ({ ...s, consoleText: s.consoleText + text }));
  };

  const handleSyscall = (sc: SyscallKind): WaitingInput | null => {
    switch (sc.kind) {
      case "print_int":
        appendConsole(String(sc.value));
        return null;
      case "print_string":
        appendConsole(sc.value);
        return null;
      case "print_char":
        appendConsole(sc.value);
        return null;
      case "exit":
        appendConsole(`\n[program exited${sc.code ? " with code " + sc.code : ""}]`);
        return null;
      case "read_int":
        return { type: "int" };
      case "read_string":
        return { type: "string", maxLen: sc.maxLen, addr: sc.addr };
      case "unknown":
        appendConsole(`\n[unsupported syscall $v0=${sc.code}]\n`);
        return null;
    }
  };

  const assembleProgram = useCallback((source: string) => {
    stopFlag.current = true;
    const program = assemble(source);
    if (!program.ok) {
      programRef.current = null;
      cpuRef.current = null;
      setState({ ...INITIAL, status: "error", errors: program.errors });
      return;
    }
    const mem = buildInitialMemory(program, source);
    const cpu = new CPU(program, mem);
    programRef.current = program;
    memRef.current = mem;
    cpuRef.current = cpu;
    totalSteps.current = 0;
    setState({
      ...INITIAL,
      status: "assembled",
      errors: [],
      registers: Array.from(cpu.regs),
      pc: cpu.pc,
      currentLine: cpu.currentLine() ?? null,
    });
  }, []);

  const doOneStep = (): "ok" | "halted" | "waiting" | "error" => {
    const cpu = cpuRef.current;
    if (!cpu || cpu.halted) return "halted";
    const { syscall, error } = cpu.step();
    totalSteps.current++;
    if (error) {
      snapshot({ status: "error", errors: [{ line: cpu.currentLine() ?? 0, message: error }] });
      return "error";
    }
    if (syscall) {
      const waiting = handleSyscall(syscall);
      if (waiting) {
        snapshot({ status: "halted", waitingInput: waiting });
        return "waiting";
      }
    }
    if (cpu.halted) return "halted";
    return "ok";
  };

  const step = useCallback(() => {
    const result = doOneStep();
    if (result === "ok") snapshot({ status: "assembled" });
    else if (result === "halted") snapshot({ status: "halted", waitingInput: null });
    // "waiting" and "error" already snapshot inside doOneStep
  }, [snapshot]);

  const run = useCallback(() => {
    stopFlag.current = false;
    setState((s) => ({ ...s, status: "running" }));

    const chunk = () => {
      if (stopFlag.current) {
        snapshot({ status: "assembled" });
        return;
      }
      let count = 0;
      let result: ReturnType<typeof doOneStep> = "ok";
      while (count < MAX_STEPS_PER_CHUNK) {
        result = doOneStep();
        count++;
        if (result !== "ok") break;
        if (totalSteps.current > MAX_TOTAL_STEPS) {
          snapshot({
            status: "error",
            errors: [{ line: 0, message: "Instruction limit exceeded (possible infinite loop)" }],
          });
          return;
        }
      }
      if (result === "ok") {
        snapshot({ status: "running" });
        setTimeout(chunk, 0);
      } else if (result === "halted") {
        snapshot({ status: "halted", waitingInput: null });
      } else if (result === "waiting") {
        // snapshot already applied inside doOneStep
      } else if (result === "error") {
        // snapshot already applied inside doOneStep
      }
    };
    chunk();
  }, [snapshot]);

  const stop = useCallback(() => {
    stopFlag.current = true;
  }, []);

  const reset = useCallback(() => {
    const program = programRef.current;
    if (!program) {
      setState(INITIAL);
      return;
    }
    // Re-assemble is the simplest reliable way to reset memory + registers.
    const src = lastSourceRef.current;
    if (src != null) assembleProgram(src);
  }, [assembleProgram]);

  const lastSourceRef = useRef<string | null>(null);
  const assembleAndRemember = useCallback((source: string) => {
    lastSourceRef.current = source;
    assembleProgram(source);
  }, [assembleProgram]);

  const submitIntInput = useCallback((value: number) => {
    const cpu = cpuRef.current;
    if (!cpu) return;
    cpu.resolveSyscallInput(value);
    snapshot({ status: "assembled", waitingInput: null });
  }, [snapshot]);

  const submitStringInput = useCallback((value: string) => {
    const cpu = cpuRef.current;
    const mem = memRef.current;
    if (!cpu || !mem || state.waitingInput?.type !== "string") return;
    const w = state.waitingInput;
    const truncated = value.slice(0, Math.max(0, w.maxLen - 1));
    mem.writeString(w.addr, truncated, true);
    snapshot({ status: "assembled", waitingInput: null });
  }, [snapshot, state.waitingInput]);

  const readMemory = useCallback((addr: number, count: number): number[] => {
    const mem = memRef.current;
    if (!mem) return new Array(count).fill(0);
    return mem.dumpRange(addr, count);
  }, []);

  return {
    state,
    assembleProgram: assembleAndRemember,
    step,
    run,
    stop,
    reset,
    submitIntInput,
    submitStringInput,
    readMemory,
    program: programRef,
  };
}
