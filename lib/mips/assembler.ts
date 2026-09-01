import { resolveRegister } from "./registers";
import { Memory, TEXT_BASE, DATA_BASE } from "./memory";
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
  instructions: Instr[]; // indexed by (addr - TEXT_BASE)/4
  textStart: number;
  textEnd: number;
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
const LOAD_STORE = new Set(["lw", "sw", "lb", "lbu", "sb", "lh", "lhu", "sh"]);
const JUMP = new Set(["j", "jal"]);
const JUMP_R = new Set(["jr", "jalr"]);
const NO_ARG = new Set(["syscall", "nop"]);
const MULT_DIV = new Set(["mult", "multu", "div", "divu"]);
const MOVE_FROM = new Set(["mfhi", "mflo"]);
const MOVE_TO = new Set(["mthi", "mtlo"]);

// Pseudo-instructions expanded before address assignment.
const PSEUDO = new Set([
  "li", "la", "move", "blt", "bgt", "ble", "bge", "bltu", "bgtu", "bleu",
  "bgeu", "beqz", "bnez", "not", "b", "neg", "seq", "sne", "sle", "sge",
]);

interface RawLine {
  text: string;
  line: number;
}

function stripComment(s: string): string {
  const i = s.indexOf("#");
  return i >= 0 ? s.slice(0, i) : s;
}

function splitArgs(s: string): string[] {
  s = s.trim();
  if (!s) return [];
  return s.split(",").map((a) => a.trim()).filter((a) => a.length > 0);
}

function parseIntLiteral(tok: string): number | null {
  tok = tok.trim();
  if (/^-?0x[0-9a-fA-F]+$/.test(tok)) return parseInt(tok, 16) * (tok.startsWith("-") ? -1 : 1) | 0;
  if (/^-?\d+$/.test(tok)) return parseInt(tok, 10);
  return null;
}

// Parses "imm($reg)" or just "$reg" (imm=0) forms used by load/store.
function parseMemOperand(tok: string): { imm: string; reg: string } | null {
  const m = tok.match(/^(-?[\w+\-]*)\s*\(\s*(\$\w+)\s*\)$/);
  if (m) return { imm: m[1] || "0", reg: m[2] };
  return null;
}

export function assemble(source: string): AssembledProgram {
  const errors: AssembleError[] = [];
  const rawLines: RawLine[] = source.split("\n").map((text, i) => ({ text, line: i + 1 }));

  type PendingInstr = { op: string; args: string[]; line: number };
  type DataItem =
    | { kind: "word"; values: number[] }
    | { kind: "half"; values: number[] }
    | { kind: "byte"; values: number[] }
    | { kind: "ascii"; text: string; z: boolean }
    | { kind: "space"; bytes: number }
    | { kind: "align"; n: number };

  const textLabels: Map<string, number> = new Map(); // label -> instruction index (pending)
  const dataLabels: Map<string, string> = new Map(); // label -> resolved later
  const pendingInstrs: PendingInstr[] = [];
  const dataItems: { label?: string; item: DataItem; line: number }[] = [];

  let section: "text" | "data" = "text";

  for (const raw of rawLines) {
    let line = stripComment(raw.text).trim();
    if (!line) continue;

    // Pull off leading label(s): "label:" possibly followed by more content.
    let label: string | undefined;
    const labelMatch = line.match(/^([A-Za-z_.][A-Za-z0-9_.]*)\s*:\s*(.*)$/);
    if (labelMatch) {
      label = labelMatch[1];
      line = labelMatch[2].trim();
    }

    if (line.startsWith(".")) {
      const spaceIdx = line.search(/\s/);
      const directive = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).toLowerCase();
      const rest = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim();

      if (directive === ".text") { section = "text"; if (label) textLabels.set(label, pendingInstrs.length); continue; }
      if (directive === ".data") { section = "data"; if (label) dataItems.push({ label, item: { kind: "space", bytes: 0 }, line: raw.line }); continue; }
      if (directive === ".globl" || directive === ".global") { continue; }

      if (section === "data") {
        if (directive === ".word") {
          const values = splitArgs(rest).map((t) => parseIntLiteral(t) ?? 0);
          dataItems.push({ label, item: { kind: "word", values }, line: raw.line });
        } else if (directive === ".half") {
          const values = splitArgs(rest).map((t) => parseIntLiteral(t) ?? 0);
          dataItems.push({ label, item: { kind: "half", values }, line: raw.line });
        } else if (directive === ".byte") {
          const values = splitArgs(rest).map((t) => parseIntLiteral(t) ?? 0);
          dataItems.push({ label, item: { kind: "byte", values }, line: raw.line });
        } else if (directive === ".ascii" || directive === ".asciiz") {
          const m = rest.match(/^"((?:[^"\\]|\\.)*)"/);
          const text = m ? unescapeString(m[1]) : "";
          dataItems.push({ label, item: { kind: "ascii", text, z: directive === ".asciiz" }, line: raw.line });
        } else if (directive === ".space") {
          const n = parseIntLiteral(rest) ?? 0;
          dataItems.push({ label, item: { kind: "space", bytes: n }, line: raw.line });
        } else if (directive === ".align") {
          const n = parseIntLiteral(rest) ?? 0;
          dataItems.push({ label, item: { kind: "align", n }, line: raw.line });
        } else {
          errors.push({ line: raw.line, message: `Unknown directive '${directive}'` });
        }
        continue;
      } else {
        // Unknown directive in text section, ignore quietly (e.g. .ent/.end/.set)
        continue;
      }
    }

    if (section === "data") {
      if (label) dataItems.push({ label, item: { kind: "space", bytes: 0 }, line: raw.line });
      if (line) errors.push({ line: raw.line, message: `Unexpected instruction in .data section` });
      continue;
    }

    // .text section: instruction (possibly empty if line was only a label)
    if (label) textLabels.set(label, pendingInstrs.length);
    if (!line) continue;

    const spaceIdx = line.search(/\s/);
    const op = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).toLowerCase();
    const rest = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim();
    const args = splitArgs(rest);

    expandPseudo(op, args, raw.line, pendingInstrs, errors);
  }

  // --- Lay out .data section ---
  const memory = new Memory();
  let dataAddr = DATA_BASE;
  const labels = new Map<string, number>();

  for (const { label, item, line } of dataItems) {
    if (item.kind === "align") {
      const align = 1 << item.n;
      if (align > 0) dataAddr = Math.ceil(dataAddr / align) * align;
      if (label) labels.set(label, dataAddr);
      continue;
    }
    if (item.kind === "word") {
      dataAddr = Math.ceil(dataAddr / 4) * 4;
      if (label) labels.set(label, dataAddr);
      for (const v of item.values) { memory.writeWord(dataAddr, v); dataAddr += 4; }
      continue;
    }
    if (item.kind === "half") {
      dataAddr = Math.ceil(dataAddr / 2) * 2;
      if (label) labels.set(label, dataAddr);
      for (const v of item.values) { memory.writeHalf(dataAddr, v); dataAddr += 2; }
      continue;
    }
    if (item.kind === "byte") {
      if (label) labels.set(label, dataAddr);
      for (const v of item.values) { memory.writeByte(dataAddr, v); dataAddr += 1; }
      continue;
    }
    if (item.kind === "ascii") {
      if (label) labels.set(label, dataAddr);
      memory.writeString(dataAddr, item.text, item.z);
      dataAddr += item.text.length + (item.z ? 1 : 0);
      continue;
    }
    if (item.kind === "space") {
      if (label) labels.set(label, dataAddr);
      dataAddr += item.bytes;
      continue;
    }
  }

  // --- Lay out .text section ---
  const instructions: Instr[] = pendingInstrs.map((p, i) => ({
    op: p.op,
    args: p.args,
    line: p.line,
    addr: TEXT_BASE + i * 4,
  }));
  for (const [name, idx] of textLabels) {
    labels.set(name, TEXT_BASE + idx * 4);
  }

  // --- Validate operands / resolve labels referenced in branch/jump/la ---
  for (const instr of instructions) {
    validateInstruction(instr, labels, errors);
  }

  let entry = TEXT_BASE;
  if (labels.has("main")) entry = labels.get("main")!;

  return {
    ok: errors.length === 0,
    errors,
    instructions,
    textStart: TEXT_BASE,
    textEnd: TEXT_BASE + instructions.length * 4,
    labels,
    entry,
  };
}

function unescapeString(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\0/g, "\0")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

// Emits `sltOp $at, lhs, rhs` followed by `branchOp $at, $zero, label`, materializing
// any immediate operand (e.g. `bgt $t0, 10, done`) into a scratch register first.
function pushCompareBranch(
  out: { op: string; args: string[]; line: number }[],
  line: number,
  sltOp: string,
  lhs: string,
  rhs: string,
  label: string,
  branchOp: string
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
  out: { op: string; args: string[]; line: number }[],
  errors: AssembleError[]
) {
  switch (op) {
    case "li": {
      const [rd, immTok] = args;
      const imm = parseIntLiteral(immTok) ?? 0;
      if (imm >= -32768 && imm <= 65535) {
        out.push({ op: "addiu", args: [rd, "$zero", String(imm)], line });
      } else {
        out.push({ op: "lui", args: [rd, String((imm >>> 16) & 0xffff)], line });
        out.push({ op: "ori", args: [rd, rd, String(imm & 0xffff)], line });
      }
      return;
    }
    case "la": {
      const [rd, sym] = args;
      out.push({ op: "__la", args: [rd, sym], line });
      return;
    }
    case "move": {
      const [rd, rs] = args;
      out.push({ op: "addu", args: [rd, rs, "$zero"], line });
      return;
    }
    case "nop":
      out.push({ op: "sll", args: ["$zero", "$zero", "0"], line });
      return;
    case "b":
      out.push({ op: "beq", args: ["$zero", "$zero", args[0]], line });
      return;
    case "beqz":
      out.push({ op: "beq", args: [args[0], "$zero", args[1]], line });
      return;
    case "bnez":
      out.push({ op: "bne", args: [args[0], "$zero", args[1]], line });
      return;
    case "not":
      out.push({ op: "nor", args: [args[0], args[1], "$zero"], line });
      return;
    case "neg":
      out.push({ op: "sub", args: [args[0], "$zero", args[1]], line });
      return;
    case "blt":
      pushCompareBranch(out, line, "slt", args[0], args[1], args[2], "bne");
      return;
    case "bltu":
      pushCompareBranch(out, line, "sltu", args[0], args[1], args[2], "bne");
      return;
    case "bgt":
      pushCompareBranch(out, line, "slt", args[1], args[0], args[2], "bne");
      return;
    case "bgtu":
      pushCompareBranch(out, line, "sltu", args[1], args[0], args[2], "bne");
      return;
    case "ble":
      pushCompareBranch(out, line, "slt", args[1], args[0], args[2], "beq");
      return;
    case "bleu":
      pushCompareBranch(out, line, "sltu", args[1], args[0], args[2], "beq");
      return;
    case "bge":
      pushCompareBranch(out, line, "slt", args[0], args[1], args[2], "beq");
      return;
    case "bgeu":
      pushCompareBranch(out, line, "sltu", args[0], args[1], args[2], "beq");
      return;
    case "seq":
      out.push({ op: "sub", args: [args[0], args[1], args[2]], line });
      out.push({ op: "sltiu", args: [args[0], args[0], "1"], line });
      return;
    case "sne":
      out.push({ op: "sub", args: [args[0], args[1], args[2]], line });
      out.push({ op: "sltu", args: [args[0], "$zero", args[0]], line });
      return;
    default:
      out.push({ op, args, line });
  }
}

const KNOWN_OPS = new Set([
  ...R_TYPE_3, ...SHIFT_OPS, ...SHIFT_V_OPS, ...I_TYPE_ARITH, ...BRANCH2, ...BRANCH1,
  ...LOAD_STORE, ...JUMP, ...JUMP_R, ...NO_ARG, ...MULT_DIV, ...MOVE_FROM, ...MOVE_TO,
  "lui", "__la",
]);

function validateInstruction(instr: Instr, labels: Map<string, number>, errors: AssembleError[]) {
  const { op, args, line } = instr;
  if (!KNOWN_OPS.has(op)) {
    errors.push({ line, message: `Unknown instruction '${op}'` });
    return;
  }
  const regOk = (t: string) => resolveRegister(t) !== null;

  if (R_TYPE_3.has(op)) {
    if (args.length !== 3 || !args.every(regOk)) errors.push({ line, message: `${op} expects 3 registers` });
  } else if (SHIFT_OPS.has(op)) {
    if (args.length !== 3 || !regOk(args[0]) || !regOk(args[1]) || parseIntLiteral(args[2]) === null)
      errors.push({ line, message: `${op} expects rd, rt, shamt` });
  } else if (SHIFT_V_OPS.has(op)) {
    if (args.length !== 3 || !args.every(regOk)) errors.push({ line, message: `${op} expects 3 registers` });
  } else if (I_TYPE_ARITH.has(op)) {
    if (args.length !== 3 || !regOk(args[0]) || !regOk(args[1]) || parseIntLiteral(args[2]) === null)
      errors.push({ line, message: `${op} expects rd, rs, immediate` });
  } else if (op === "lui") {
    if (args.length !== 2 || !regOk(args[0]) || parseIntLiteral(args[1]) === null)
      errors.push({ line, message: `lui expects rd, immediate` });
  } else if (BRANCH2.has(op)) {
    if (args.length !== 3 || !regOk(args[0]) || !regOk(args[1]) || !labels.has(args[2]))
      errors.push({ line, message: `${op} expects rs, rt, label ('${args[2]}' undefined?)` });
  } else if (BRANCH1.has(op)) {
    if (args.length !== 2 || !regOk(args[0]) || !labels.has(args[1]))
      errors.push({ line, message: `${op} expects rs, label ('${args[1]}' undefined?)` });
  } else if (LOAD_STORE.has(op)) {
    if (args.length !== 2 || !regOk(args[0])) {
      errors.push({ line, message: `${op} expects rt, offset(rs)` });
    } else {
      const mem = parseMemOperand(args[1]);
      if (!mem || !regOk(mem.reg) || (parseIntLiteral(mem.imm) === null && !labels.has(mem.imm))) {
        errors.push({ line, message: `${op} expects rt, offset(rs)` });
      }
    }
  } else if (JUMP.has(op)) {
    if (args.length !== 1 || !labels.has(args[0]))
      errors.push({ line, message: `${op} expects a label ('${args[0]}' undefined?)` });
  } else if (JUMP_R.has(op)) {
    if (args.length < 1 || !regOk(args[0])) errors.push({ line, message: `${op} expects a register` });
  } else if (NO_ARG.has(op)) {
    // no args required
  } else if (MULT_DIV.has(op)) {
    if (args.length !== 2 || !args.every(regOk)) errors.push({ line, message: `${op} expects 2 registers` });
  } else if (MOVE_FROM.has(op)) {
    if (args.length !== 1 || !regOk(args[0])) errors.push({ line, message: `${op} expects 1 register` });
  } else if (MOVE_TO.has(op)) {
    if (args.length !== 1 || !regOk(args[0])) errors.push({ line, message: `${op} expects 1 register` });
  } else if (op === "__la") {
    if (args.length !== 2 || !regOk(args[0]) || !labels.has(args[1]))
      errors.push({ line, message: `la expects rd, label ('${args[1]}' undefined?)` });
  }
}

export function buildInitialMemory(program: AssembledProgram, source: string): Memory {
  // Re-run the data-section layout to build the actual Memory object returned to the CPU.
  // (assemble() already builds one internally for label resolution consistency; we rebuild
  // here from source to keep assemble() side-effect free w.r.t. its return signature.)
  const mem = new Memory();
  const rawLines = source.split("\n");
  let section: "text" | "data" = "text";
  let dataAddr = DATA_BASE;
  for (let i = 0; i < rawLines.length; i++) {
    let line = stripComment(rawLines[i]).trim();
    if (!line) continue;
    const labelMatch = line.match(/^([A-Za-z_.][A-Za-z0-9_.]*)\s*:\s*(.*)$/);
    if (labelMatch) line = labelMatch[2].trim();
    if (line.startsWith(".text")) { section = "text"; continue; }
    if (line.startsWith(".data")) { section = "data"; continue; }
    if (section !== "data") continue;
    if (!line.startsWith(".")) continue;
    const spaceIdx = line.search(/\s/);
    const directive = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).toLowerCase();
    const rest = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim();
    if (directive === ".word") {
      dataAddr = Math.ceil(dataAddr / 4) * 4;
      for (const t of splitArgs(rest)) { mem.writeWord(dataAddr, parseIntLiteral(t) ?? 0); dataAddr += 4; }
    } else if (directive === ".half") {
      dataAddr = Math.ceil(dataAddr / 2) * 2;
      for (const t of splitArgs(rest)) { mem.writeHalf(dataAddr, parseIntLiteral(t) ?? 0); dataAddr += 2; }
    } else if (directive === ".byte") {
      for (const t of splitArgs(rest)) { mem.writeByte(dataAddr, parseIntLiteral(t) ?? 0); dataAddr += 1; }
    } else if (directive === ".ascii" || directive === ".asciiz") {
      const m = rest.match(/^"((?:[^"\\]|\\.)*)"/);
      const text = m ? unescapeString(m[1]) : "";
      mem.writeString(dataAddr, text, directive === ".asciiz");
      dataAddr += text.length + (directive === ".asciiz" ? 1 : 0);
    } else if (directive === ".space") {
      dataAddr += parseIntLiteral(rest) ?? 0;
    } else if (directive === ".align") {
      const align = 1 << (parseIntLiteral(rest) ?? 0);
      if (align > 0) dataAddr = Math.ceil(dataAddr / align) * align;
    }
  }
  return mem;
}

export { parseMemOperand, parseIntLiteral };
