import { resolveFloatRegister, resolveRegister } from "./registers";
import { DATA_BASE, Memory, TEXT_BASE } from "./memory";
import type { AssembleError } from "./types";

export interface Instr {
  op: string;
  args: string[];
  line: number;
  addr: number;
}

export interface AssembledProgram {
  ok: boolean;
  errors: AssembleError[];
  instructions: Instr[];
  textStart: number;
  textEnd: number;
  dataStart: number;
  dataEnd: number;
  labels: Map<string, number>;
  entry: number;
}

const R_TYPE_3 = new Set([
  "add", "addu", "sub", "subu", "and", "or", "xor", "nor", "slt", "sltu",
]);
const SHIFT_OPS = new Set(["sll", "srl", "sra"]);
const SHIFT_V_OPS = new Set(["sllv", "srlv", "srav"]);
const I_TYPE_ARITH = new Set(["addi", "addiu", "andi", "ori", "xori", "slti", "sltiu"]);
const BRANCH2 = new Set(["beq", "bne"]);
const BRANCH1 = new Set(["blez", "bgtz", "bltz", "bgez"]);
const LOAD_STORE = new Set([
  "lb", "lh", "lw", "lbu", "lhu", "sb", "sh", "sw", "ll", "sc",
]);
const JUMP = new Set(["j", "jal"]);
const JUMP_R = new Set(["jr", "jalr"]);
const NO_ARG = new Set(["syscall", "nop", "break", "sync"]);
const MULT_DIV = new Set(["mult", "multu", "div", "divu"]);
const MOVE_FROM = new Set(["mfhi", "mflo"]);
const MOVE_TO = new Set(["mthi", "mtlo"]);
const FP_ARITH = new Set([
  "add.s", "add.d", "sub.s", "sub.d", "mul.s", "mul.d", "div.s", "div.d",
]);
const FP_MEMORY = new Set(["lwc1", "ldc1", "swc1", "sdc1"]);
const FP_BRANCH = new Set(["bc1t", "bc1f"]);

// The card's pseudo-instruction table contains the first five entries. The
// additional entries preserve useful integer assembler conveniences already
// supported by the application.
const PSEUDO = new Set([
  "li", "la", "move", "blt", "bgt", "ble", "bge", "bltu", "bgtu", "bleu",
  "bgeu", "beqz", "bnez", "not", "b", "neg", "seq", "sne", "sle", "sge",
]);

type PendingInstr = { op: string; args: string[]; line: number };
type DataItem =
  | { kind: "word"; values: number[] }
  | { kind: "half"; values: number[] }
  | { kind: "byte"; values: number[] }
  | { kind: "ascii"; text: string; z: boolean }
  | { kind: "space"; bytes: number }
  | { kind: "align"; n: number };
type DataRecord = { labels: string[]; item: DataItem; line: number };

interface ParsedSource {
  pendingInstrs: PendingInstr[];
  textLabels: Map<string, number>;
  dataItems: DataRecord[];
}

function stripComment(s: string): string {
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const char = s[i];
    if (char === "\\" && quoted) {
      escaped = !escaped;
      continue;
    }
    if (char === '"' && !escaped) quoted = !quoted;
    if (char === "#" && !quoted) return s.slice(0, i);
    escaped = false;
  }
  return s;
}

function splitArgs(s: string): string[] {
  s = s.trim();
  if (!s) return [];
  return s.split(",").map((a) => a.trim()).filter((a) => a.length > 0);
}

export function parseIntLiteral(tok: string): number | null {
  tok = tok.trim();
  if (/^[+-]?0x[0-9a-fA-F]+$/.test(tok)) {
    const sign = tok.startsWith("-") ? -1 : 1;
    const digits = tok.replace(/^[+-]?0x/i, "");
    return sign * parseInt(digits, 16);
  }
  if (/^[+-]?\d+$/.test(tok)) return parseInt(tok, 10);
  return null;
}

// Parses "offset($reg)". A bare register is accepted as offset 0 for the
// same reason it is accepted by common MIPS assemblers.
export function parseMemOperand(tok: string): { imm: string; reg: string } | null {
  const m = tok.trim().match(/^([^\s()]*)\s*\(\s*(\$\w+)\s*\)$/);
  if (m) return { imm: m[1] || "0", reg: m[2] };
  return null;
}

function takeLeadingLabels(line: string): { labels: string[]; rest: string } {
  const labels: string[] = [];
  let rest = line.trim();
  while (true) {
    const match = rest.match(/^([A-Za-z_.][A-Za-z0-9_.]*)\s*:\s*(.*)$/);
    if (!match) break;
    labels.push(match[1]);
    rest = match[2].trim();
  }
  return { labels, rest };
}

function unescapeString(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\0/g, "\0")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function parseNumberList(
  rest: string,
  directive: string,
  line: number,
  errors: AssembleError[],
): number[] {
  const tokens = splitArgs(rest);
  if (tokens.length === 0) {
    errors.push({ line, message: `${directive} expects at least one value` });
    return [];
  }
  return tokens.map((token) => {
    const value = parseIntLiteral(token);
    if (value === null) {
      errors.push({ line, message: `${directive} expects numeric values (invalid '${token}')` });
      return 0;
    }
    return value;
  });
}

function parseSource(source: string, errors: AssembleError[]): ParsedSource {
  const pendingInstrs: PendingInstr[] = [];
  const textLabels = new Map<string, number>();
  const dataItems: DataRecord[] = [];
  let section: "text" | "data" = "text";

  const rawLines = source.split("\n");
  for (let i = 0; i < rawLines.length; i++) {
    const lineNumber = i + 1;
    const { labels, rest: sourceLine } = takeLeadingLabels(stripComment(rawLines[i]).trim());
    const line = sourceLine;
    if (!line && labels.length === 0) continue;

    if (line.startsWith(".")) {
      const spaceIdx = line.search(/\s/);
      const directive = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).toLowerCase();
      const rest = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim();

      if (directive === ".text") {
        section = "text";
        for (const label of labels) recordTextLabel(textLabels, label, pendingInstrs.length, lineNumber, errors);
        continue;
      }
      if (directive === ".data") {
        section = "data";
        if (labels.length > 0) dataItems.push({ labels, item: { kind: "space", bytes: 0 }, line: lineNumber });
        continue;
      }
      if (directive === ".globl" || directive === ".global") continue;

      if (section === "data") {
        let item: DataItem | null = null;
        if (directive === ".word") {
          item = { kind: "word", values: parseNumberList(rest, directive, lineNumber, errors) };
        } else if (directive === ".half") {
          item = { kind: "half", values: parseNumberList(rest, directive, lineNumber, errors) };
        } else if (directive === ".byte") {
          item = { kind: "byte", values: parseNumberList(rest, directive, lineNumber, errors) };
        } else if (directive === ".ascii" || directive === ".asciiz") {
          const match = rest.match(/^"((?:[^"\\]|\\.)*)"\s*$/);
          if (!match) {
            errors.push({ line: lineNumber, message: `${directive} expects one quoted string` });
            item = { kind: "ascii", text: "", z: directive === ".asciiz" };
          } else {
            item = { kind: "ascii", text: unescapeString(match[1]), z: directive === ".asciiz" };
          }
        } else if (directive === ".space") {
          const bytes = parseIntLiteral(rest);
          if (bytes === null || bytes < 0) {
            errors.push({ line: lineNumber, message: ".space expects a non-negative integer" });
            item = { kind: "space", bytes: 0 };
          } else {
            item = { kind: "space", bytes };
          }
        } else if (directive === ".align") {
          const n = parseIntLiteral(rest);
          if (n === null || n < 0 || n > 30) {
            errors.push({ line: lineNumber, message: ".align expects an integer from 0 through 30" });
            item = { kind: "align", n: 0 };
          } else {
            item = { kind: "align", n };
          }
        } else {
          errors.push({ line: lineNumber, message: `Unknown directive '${directive}'` });
        }
        if (item) dataItems.push({ labels, item, line: lineNumber });
        continue;
      }

      // These directives are metadata used by some MIPS assemblers and do
      // not change the instruction stream in this simulator.
      if (directive !== ".set" && directive !== ".ent" && directive !== ".end") {
        errors.push({ line: lineNumber, message: `Unknown directive '${directive}'` });
      }
      continue;
    }

    if (section === "data") {
      if (labels.length > 0) dataItems.push({ labels, item: { kind: "space", bytes: 0 }, line: lineNumber });
      if (line) errors.push({ line: lineNumber, message: "Unexpected instruction in .data section" });
      continue;
    }

    for (const label of labels) recordTextLabel(textLabels, label, pendingInstrs.length, lineNumber, errors);
    if (!line) continue;

    const spaceIdx = line.search(/\s/);
    const op = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).toLowerCase();
    const rest = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim();
    expandPseudo(op, splitArgs(rest), lineNumber, pendingInstrs, errors);
  }

  return { pendingInstrs, textLabels, dataItems };
}

function recordTextLabel(
  labels: Map<string, number>,
  name: string,
  instructionIndex: number,
  line: number,
  errors: AssembleError[],
) {
  if (labels.has(name)) errors.push({ line, message: `Duplicate label '${name}'` });
  else labels.set(name, instructionIndex);
}

function defineLabel(
  labels: Map<string, number>,
  name: string,
  address: number,
  line: number,
  errors: AssembleError[],
) {
  if (labels.has(name)) {
    errors.push({ line, message: `Duplicate label '${name}'` });
  } else {
    labels.set(name, address);
  }
}

function layoutData(
  dataItems: DataRecord[],
  labels: Map<string, number>,
  errors: AssembleError[],
): { memory: Memory; end: number } {
  const memory = new Memory();
  let dataAddr = DATA_BASE;

  for (const { labels: names, item, line } of dataItems) {
    if (item.kind === "align") {
      const alignment = 1 << item.n;
      dataAddr = Math.ceil(dataAddr / alignment) * alignment;
      for (const name of names) defineLabel(labels, name, dataAddr, line, errors);
      continue;
    }
    if (item.kind === "word") {
      dataAddr = Math.ceil(dataAddr / 4) * 4;
      for (const name of names) defineLabel(labels, name, dataAddr, line, errors);
      for (const value of item.values) {
        memory.writeWord(dataAddr, value);
        dataAddr += 4;
      }
      continue;
    }
    if (item.kind === "half") {
      dataAddr = Math.ceil(dataAddr / 2) * 2;
      for (const name of names) defineLabel(labels, name, dataAddr, line, errors);
      for (const value of item.values) {
        memory.writeHalf(dataAddr, value);
        dataAddr += 2;
      }
      continue;
    }
    if (item.kind === "byte") {
      for (const name of names) defineLabel(labels, name, dataAddr, line, errors);
      for (const value of item.values) {
        memory.writeByte(dataAddr, value);
        dataAddr += 1;
      }
      continue;
    }
    if (item.kind === "ascii") {
      for (const name of names) defineLabel(labels, name, dataAddr, line, errors);
      memory.writeString(dataAddr, item.text, item.z);
      dataAddr += item.text.length + (item.z ? 1 : 0);
      continue;
    }

    for (const name of names) defineLabel(labels, name, dataAddr, line, errors);
    dataAddr += item.bytes;
  }

  return { memory, end: dataAddr };
}

export function assemble(source: string): AssembledProgram {
  const errors: AssembleError[] = [];
  const parsed = parseSource(source, errors);
  const labels = new Map<string, number>();
  const dataLayout = layoutData(parsed.dataItems, labels, errors);

  const instructions: Instr[] = parsed.pendingInstrs.map((pending, index) => ({
    ...pending,
    addr: TEXT_BASE + index * 4,
  }));

  for (const [name, index] of parsed.textLabels) {
    defineLabel(labels, name, TEXT_BASE + index * 4, 0, errors);
  }
  for (const instruction of instructions) validateInstruction(instruction, labels, errors);

  return {
    ok: errors.length === 0,
    errors,
    instructions,
    textStart: TEXT_BASE,
    textEnd: TEXT_BASE + instructions.length * 4,
    dataStart: DATA_BASE,
    dataEnd: dataLayout.end,
    labels,
    entry: labels.get("main") ?? TEXT_BASE,
  };
}

// Emits the comparison pseudo-instructions using the integer instructions on
// the reference card. Immediate operands are accepted as a convenience.
function pushCompareBranch(
  out: PendingInstr[],
  line: number,
  sltOp: string,
  lhs: string,
  rhs: string,
  label: string,
  branchOp: string,
) {
  let lhsReg = lhs;
  let rhsReg = rhs;
  if (resolveRegister(lhs) === null) {
    out.push({ op: "addiu", args: ["$at", "$zero", lhs], line });
    lhsReg = "$at";
    if (resolveRegister(rhs) === null) {
      out.push({ op: "addiu", args: ["$k1", "$zero", rhs], line });
      rhsReg = "$k1";
    }
  } else if (resolveRegister(rhs) === null) {
    out.push({ op: "addiu", args: ["$at", "$zero", rhs], line });
    rhsReg = "$at";
  }
  out.push({ op: sltOp, args: ["$at", lhsReg, rhsReg], line });
  out.push({ op: branchOp, args: ["$at", "$zero", label], line });
}

function expandPseudo(
  op: string,
  args: string[],
  line: number,
  out: PendingInstr[],
  errors: AssembleError[],
) {
  const requireArgs = (count: number): boolean => {
    if (args.length !== count) {
      errors.push({ line, message: `${op} expects ${count} operand${count === 1 ? "" : "s"}` });
      return false;
    }
    return true;
  };

  switch (op) {
    case "li": {
      if (!requireArgs(2)) return;
      const immediate = parseIntLiteral(args[1]);
      if (immediate === null) {
        errors.push({ line, message: "li expects a numeric immediate" });
        return;
      }
      if (immediate >= -32768 && immediate <= 32767) {
        out.push({ op: "addiu", args: [args[0], "$zero", String(immediate)], line });
      } else if (immediate >= 0 && immediate <= 0xffff) {
        out.push({ op: "ori", args: [args[0], "$zero", String(immediate)], line });
      } else {
        out.push({ op: "lui", args: [args[0], String((immediate >>> 16) & 0xffff)], line });
        out.push({ op: "ori", args: [args[0], args[0], String(immediate & 0xffff)], line });
      }
      return;
    }
    case "la":
      if (requireArgs(2)) out.push({ op: "__la", args: [args[0], args[1]], line });
      return;
    case "move":
      if (requireArgs(2)) out.push({ op: "addu", args: [args[0], args[1], "$zero"], line });
      return;
    case "nop":
      if (requireArgs(0)) out.push({ op: "sll", args: ["$zero", "$zero", "0"], line });
      return;
    case "b":
      if (requireArgs(1)) out.push({ op: "beq", args: ["$zero", "$zero", args[0]], line });
      return;
    case "beqz":
      if (requireArgs(2)) out.push({ op: "beq", args: [args[0], "$zero", args[1]], line });
      return;
    case "bnez":
      if (requireArgs(2)) out.push({ op: "bne", args: [args[0], "$zero", args[1]], line });
      return;
    case "not":
      if (requireArgs(2)) out.push({ op: "nor", args: [args[0], args[1], "$zero"], line });
      return;
    case "neg":
      if (requireArgs(2)) out.push({ op: "sub", args: [args[0], "$zero", args[1]], line });
      return;
    case "blt":
      if (requireArgs(3)) pushCompareBranch(out, line, "slt", args[0], args[1], args[2], "bne");
      return;
    case "bltu":
      if (requireArgs(3)) pushCompareBranch(out, line, "sltu", args[0], args[1], args[2], "bne");
      return;
    case "bgt":
      if (requireArgs(3)) pushCompareBranch(out, line, "slt", args[1], args[0], args[2], "bne");
      return;
    case "bgtu":
      if (requireArgs(3)) pushCompareBranch(out, line, "sltu", args[1], args[0], args[2], "bne");
      return;
    case "ble":
      if (requireArgs(3)) pushCompareBranch(out, line, "slt", args[1], args[0], args[2], "beq");
      return;
    case "bleu":
      if (requireArgs(3)) pushCompareBranch(out, line, "sltu", args[1], args[0], args[2], "beq");
      return;
    case "bge":
      if (requireArgs(3)) pushCompareBranch(out, line, "slt", args[0], args[1], args[2], "beq");
      return;
    case "bgeu":
      if (requireArgs(3)) pushCompareBranch(out, line, "sltu", args[0], args[1], args[2], "beq");
      return;
    case "seq":
      if (requireArgs(3)) {
        out.push({ op: "sub", args: [args[0], args[1], args[2]], line });
        out.push({ op: "sltiu", args: [args[0], args[0], "1"], line });
      }
      return;
    case "sne":
      if (requireArgs(3)) {
        out.push({ op: "sub", args: [args[0], args[1], args[2]], line });
        out.push({ op: "sltu", args: [args[0], "$zero", args[0]], line });
      }
      return;
    case "sle":
      if (requireArgs(3)) pushCompareBranch(out, line, "slt", args[1], args[0], args[2], "beq");
      return;
    case "sge":
      if (requireArgs(3)) pushCompareBranch(out, line, "slt", args[0], args[1], args[2], "beq");
      return;
    default:
      out.push({ op, args, line });
  }
}

function isFloatCompare(op: string): boolean {
  return /^c\.(eq|lt|le)\.(s|d)$/.test(op);
}

function isBranchTarget(token: string, labels: Map<string, number>): boolean {
  if (labels.has(token)) return true;
  const value = parseIntLiteral(token);
  return value !== null && value >= -32768 && value <= 32767;
}

function parseControlRegister(token: string): number | null {
  const numeric = parseIntLiteral(token);
  if (numeric !== null) return numeric >= 0 && numeric <= 31 ? numeric : null;
  const register = resolveRegister(token);
  return register === null ? null : register;
}

const KNOWN_OPS = new Set([
  ...R_TYPE_3, ...SHIFT_OPS, ...SHIFT_V_OPS, ...I_TYPE_ARITH, ...BRANCH2, ...BRANCH1,
  ...LOAD_STORE, ...JUMP, ...JUMP_R, ...NO_ARG, ...MULT_DIV, ...MOVE_FROM, ...MOVE_TO,
  ...FP_ARITH, ...FP_MEMORY, ...FP_BRANCH, "lui", "mfc0", "__la",
]);

function validateInstruction(instr: Instr, labels: Map<string, number>, errors: AssembleError[]) {
  const { op, args, line } = instr;
  if (!KNOWN_OPS.has(op) && !isFloatCompare(op)) {
    errors.push({ line, message: `Unknown instruction '${op}'` });
    return;
  }
  const regOk = (token: string) => resolveRegister(token) !== null;
  const floatRegOk = (token: string) => resolveFloatRegister(token) !== null;
  const doubleFloatRegOk = (token: string) => {
    const index = resolveFloatRegister(token);
    return index !== null && index < 31;
  };
  const immediate = (token: string) => parseIntLiteral(token) !== null;
  const signed16 = (token: string) => {
    const value = parseIntLiteral(token);
    return value !== null && value >= -32768 && value <= 32767;
  };
  const unsigned16 = (token: string) => {
    const value = parseIntLiteral(token);
    return value !== null && value >= 0 && value <= 0xffff;
  };

  if (R_TYPE_3.has(op)) {
    if (args.length !== 3 || !args.every(regOk)) errors.push({ line, message: `${op} expects 3 registers` });
  } else if (SHIFT_OPS.has(op)) {
    const shamt = parseIntLiteral(args[2] ?? "");
    if (args.length !== 3 || !regOk(args[0]) || !regOk(args[1]) || shamt === null || shamt < 0 || shamt > 31) {
      errors.push({ line, message: `${op} expects rd, rt, shamt (0-31)` });
    }
  } else if (SHIFT_V_OPS.has(op)) {
    if (args.length !== 3 || !args.every(regOk)) errors.push({ line, message: `${op} expects rd, rt, rs` });
  } else if (I_TYPE_ARITH.has(op)) {
    const validImmediate = op === "andi" || op === "ori" || op === "xori" ? unsigned16(args[2] ?? "") : signed16(args[2] ?? "");
    if (args.length !== 3 || !regOk(args[0]) || !regOk(args[1]) || !validImmediate) {
      errors.push({ line, message: `${op} expects rt, rs, a 16-bit immediate` });
    }
  } else if (op === "lui") {
    if (args.length !== 2 || !regOk(args[0]) || !unsigned16(args[1] ?? "")) {
      errors.push({ line, message: "lui expects rt, a 16-bit immediate" });
    }
  } else if (BRANCH2.has(op)) {
    if (args.length !== 3 || !regOk(args[0]) || !regOk(args[1]) || !isBranchTarget(args[2] ?? "", labels)) {
      errors.push({ line, message: `${op} expects rs, rt, label or branch offset` });
    }
  } else if (BRANCH1.has(op)) {
    if (args.length !== 2 || !regOk(args[0]) || !isBranchTarget(args[1] ?? "", labels)) {
      errors.push({ line, message: `${op} expects rs, label or branch offset` });
    }
  } else if (FP_BRANCH.has(op)) {
    if (args.length !== 1 || !isBranchTarget(args[0] ?? "", labels)) errors.push({ line, message: `${op} expects a label or branch offset` });
  } else if (LOAD_STORE.has(op)) {
    if (args.length !== 2 || !regOk(args[0])) {
      errors.push({ line, message: `${op} expects rt, offset(rs)` });
    } else {
      const mem = parseMemOperand(args[1]);
      if (!mem || !regOk(mem.reg) || (!immediate(mem.imm) && !labels.has(mem.imm))) {
        errors.push({ line, message: `${op} expects rt, offset(rs)` });
      }
    }
  } else if (JUMP.has(op)) {
    if (args.length !== 1 || !isBranchTarget(args[0] ?? "", labels)) errors.push({ line, message: `${op} expects a label or jump address` });
  } else if (JUMP_R.has(op)) {
    const valid = op === "jalr" ? (args.length === 1 || args.length === 2) : args.length === 1;
    if (!valid || !regOk(args[0]) || (args.length === 2 && !regOk(args[1]))) errors.push({ line, message: `${op} expects ${op === "jalr" ? "rd, rs" : "rs"}` });
  } else if (NO_ARG.has(op)) {
    if (args.length !== 0) errors.push({ line, message: `${op} expects no operands` });
  } else if (MULT_DIV.has(op)) {
    if (args.length !== 2 || !args.every(regOk)) errors.push({ line, message: `${op} expects 2 registers` });
  } else if (MOVE_FROM.has(op) || MOVE_TO.has(op)) {
    if (args.length !== 1 || !regOk(args[0])) errors.push({ line, message: `${op} expects 1 register` });
  } else if (op === "mfc0") {
    if (args.length !== 2 || !regOk(args[0]) || parseControlRegister(args[1]) === null) errors.push({ line, message: "mfc0 expects rt, control-register" });
  } else if (FP_ARITH.has(op)) {
    const validRegister = op.endsWith(".d") ? doubleFloatRegOk : floatRegOk;
    if (args.length !== 3 || !args.every(validRegister)) errors.push({ line, message: `${op} expects 3 floating-point registers` });
  } else if (isFloatCompare(op)) {
    const validRegister = op.endsWith(".d") ? doubleFloatRegOk : floatRegOk;
    if (args.length !== 2 || !validRegister(args[0]) || !validRegister(args[1])) errors.push({ line, message: `${op} expects 2 floating-point registers` });
  } else if (FP_MEMORY.has(op)) {
    const validRegister = op === "ldc1" || op === "sdc1" ? doubleFloatRegOk : floatRegOk;
    if (args.length !== 2 || !validRegister(args[0])) {
      errors.push({ line, message: `${op} expects ft, offset(rs)` });
    } else {
      const mem = parseMemOperand(args[1]);
      if (!mem || !regOk(mem.reg) || (!immediate(mem.imm) && !labels.has(mem.imm))) errors.push({ line, message: `${op} expects ft, offset(rs)` });
    }
  } else if (op === "__la") {
    if (args.length !== 2 || !regOk(args[0]) || !labels.has(args[1])) errors.push({ line, message: `la expects rd, label ('${args[1]}' undefined?)` });
  }
}

export function buildInitialMemory(program: AssembledProgram, source: string): Memory {
  // The program argument is intentionally kept for API compatibility. Parsing
  // the data section again guarantees that reset starts from fresh memory.
  void program;
  const parsed = parseSource(source, []);
  return layoutData(parsed.dataItems, new Map(), []).memory;
}

export { PSEUDO };
