// Shared types for the MIPS assembler + simulator

export interface AssembleError {
  line: number;
  message: string;
}

export interface AssembleResult {
  ok: boolean;
  errors: AssembleError[];
  // instruction address -> source line number (for step highlighting)
  addrToLine: Map<number, number>;
  textStart: number;
  textEnd: number;
  dataStart: number;
  dataEnd: number;
}

export type SyscallKind =
  | { kind: "print_int"; value: number }
  | { kind: "print_string"; value: string }
  | { kind: "print_char"; value: string }
  | { kind: "read_int" }
  | { kind: "read_string"; maxLen: number; addr: number }
  | { kind: "exit"; code: number }
  | { kind: "unknown"; code: number };

export interface StepResult {
  halted: boolean;
  error?: string;
  syscallOutput?: string;
  needsInput?: "int" | "string";
  pc: number;
  line?: number;
}
