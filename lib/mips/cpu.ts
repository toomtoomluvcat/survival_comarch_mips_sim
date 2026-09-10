import { GP_BASE, Memory, STACK_BASE, TEXT_BASE } from "./memory";
import { resolveFloatRegister, resolveRegister } from "./registers";
import type { AssembledProgram, Instr } from "./assembler";
import { parseIntLiteral, parseMemOperand } from "./assembler";
import type { SyscallKind } from "./types";

export class CPU {
  regs = new Int32Array(32);
  fregs = new Float64Array(32);
  pc = TEXT_BASE;
  hi = 0;
  lo = 0;
  // Coprocessor 0 state represented on the reference card.
  status = 0;
  cause = 0;
  epc = 0;
  fpCondition = false;
  memory: Memory;
  program: AssembledProgram;
  halted = false;
  pendingSyscall: SyscallKind | null = null;
  private reservationAddr: number | null = null;
  private doubleRegs = new Map<number, number>();
  private instrByAddr: Map<number, Instr>;

  constructor(program: AssembledProgram, memory: Memory) {
    this.program = program;
    this.memory = memory;
    this.instrByAddr = new Map();
    for (const instr of program.instructions) this.instrByAddr.set(instr.addr, instr);
    this.regs[28] = GP_BASE;
    this.regs[29] = STACK_BASE;
    this.pc = program.entry;
  }

  reg(index: number): number {
    return index === 0 ? 0 : this.regs[index];
  }

  setReg(index: number, value: number) {
    if (index !== 0) this.regs[index] = value | 0;
  }

  private regOf(token: string): number {
    const index = resolveRegister(token);
    if (index === null) throw new Error(`Invalid register '${token}'`);
    return index;
  }

  private fpRegOf(token: string): number {
    const index = resolveFloatRegister(token);
    if (index === null) throw new Error(`Invalid floating-point register '${token}'`);
    return index;
  }

  private clearDoubleRegister(index: number) {
    for (const base of this.doubleRegs.keys()) {
      if (base === index || base + 1 === index || base === index + 1) this.doubleRegs.delete(base);
    }
  }

  private readFpDouble(index: number): number {
    return this.doubleRegs.get(index) ?? this.fregs[index];
  }

  private writeFpSingle(index: number, value: number) {
    this.clearDoubleRegister(index);
    this.fregs[index] = Math.fround(value);
  }

  private writeFpDouble(index: number, value: number) {
    this.clearDoubleRegister(index);
    this.doubleRegs.set(index, value);
    this.fregs[index] = value;
  }

  private resolveImmOrLabel(token: string): number {
    const literal = parseIntLiteral(token);
    if (literal !== null) return literal;
    const label = this.program.labels.get(token);
    if (label !== undefined) return label;
    throw new Error(`Unresolved symbol '${token}'`);
  }

  private resolveBranchTarget(token: string): number {
    const label = this.program.labels.get(token);
    if (label !== undefined) return label;
    const immediate = parseIntLiteral(token);
    if (immediate === null) throw new Error(`Unresolved branch target '${token}'`);
    const offset = (immediate << 16) >> 16;
    return (this.pc + 4 + (offset << 2)) | 0;
  }

  private resolveJumpTarget(token: string): number {
    const label = this.program.labels.get(token);
    if (label !== undefined) return label;
    const immediate = parseIntLiteral(token);
    if (immediate === null) throw new Error(`Unresolved jump target '${token}'`);
    // Accept either a full address or the 26-bit address field shown on the
    // reference card.
    if (immediate >= TEXT_BASE) return immediate | 0;
    return (((this.pc + 4) & 0xf0000000) | ((immediate & 0x03ffffff) << 2)) | 0;
  }

  private effectiveAddress(args: string[], readReg: (token: string) => number): number {
    const operand = parseMemOperand(args[1]);
    if (!operand) throw new Error("Invalid memory operand; expected offset(rs)");
    return (readReg(operand.reg) + (this.resolveImmOrLabel(operand.imm) | 0)) | 0;
  }

  private requireAlignment(address: number, alignment: number, operation: string) {
    if ((address & (alignment - 1)) !== 0) {
      throw new Error(`Address Error on ${operation}: 0x${(address >>> 0).toString(16).padStart(8, "0")} is not ${alignment}-byte aligned`);
    }
  }

  private invalidateReservation(address: number) {
    if (this.reservationAddr !== null && (address & ~3) === (this.reservationAddr & ~3)) this.reservationAddr = null;
  }

  private readWord(address: number, operation: string): number {
    this.requireAlignment(address, 4, operation);
    return this.memory.readWord(address);
  }

  private writeWord(address: number, value: number, operation: string) {
    this.requireAlignment(address, 4, operation);
    this.invalidateReservation(address);
    this.memory.writeWord(address, value);
  }

  private readHalf(address: number, operation: string): number {
    this.requireAlignment(address, 2, operation);
    return this.memory.readHalf(address);
  }

  private writeHalf(address: number, value: number, operation: string) {
    this.requireAlignment(address, 2, operation);
    this.invalidateReservation(address);
    this.memory.writeHalf(address, value);
  }

  private writeByte(address: number, value: number) {
    this.invalidateReservation(address);
    this.memory.writeByte(address, value);
  }

  private addWithOverflow(a: number, b: number, operation: string): number {
    const result = a + b;
    if (result < -0x80000000 || result > 0x7fffffff) this.raiseException(12, `Arithmetic overflow in ${operation}`);
    return result | 0;
  }

  private subWithOverflow(a: number, b: number): number {
    const result = a - b;
    if (result < -0x80000000 || result > 0x7fffffff) this.raiseException(12, "Arithmetic overflow in sub");
    return result | 0;
  }

  currentLine(): number | undefined {
    return this.instrByAddr.get(this.pc)?.line;
  }

  /** Executes exactly one instruction. Returns a syscall request if one was hit. */
  step(): { syscall?: SyscallKind; error?: string } {
    if (this.halted) return {};
    const instr = this.instrByAddr.get(this.pc);
    if (!instr) {
      this.halted = true;
      return { error: `PC 0x${(this.pc >>> 0).toString(16)} is out of program range` };
    }
    try {
      return this.execute(instr);
    } catch (error) {
      this.halted = true;
      this.epc = this.pc;
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private executeFloatArithmetic(op: string, args: string[]) {
    const [operation, format] = op.split(".");
    const fd = this.fpRegOf(args[0]);
    const leftIndex = this.fpRegOf(args[1]);
    const rightIndex = this.fpRegOf(args[2]);
    const left = format === "s" ? this.fregs[leftIndex] : this.readFpDouble(leftIndex);
    const right = format === "s" ? this.fregs[rightIndex] : this.readFpDouble(rightIndex);
    let result: number;
    if (operation === "add") result = left + right;
    else if (operation === "sub") result = left - right;
    else if (operation === "mul") result = left * right;
    else result = left / right;
    if (format === "s") this.writeFpSingle(fd, result);
    else this.writeFpDouble(fd, result);
  }

  private executeFloatCompare(op: string, args: string[]) {
    const [, comparison, format] = op.split(".");
    const leftIndex = this.fpRegOf(args[0]);
    const rightIndex = this.fpRegOf(args[1]);
    const left = format === "s" ? this.fregs[leftIndex] : this.readFpDouble(leftIndex);
    const right = format === "s" ? this.fregs[rightIndex] : this.readFpDouble(rightIndex);
    if (comparison === "eq") this.fpCondition = left === right;
    else if (comparison === "lt") this.fpCondition = left < right;
    else this.fpCondition = left <= right;
    // Accessing the format keeps the instruction semantics explicit: both
    // operands are already stored at the requested precision by the producer.
    void format;
  }

  private controlRegister(index: number): number {
    if (index === 12) return this.status;
    if (index === 13) return this.cause;
    if (index === 14) return this.epc;
    throw new Error(`Unsupported coprocessor 0 register $${index}`);
  }

  private raiseException(code: number, message: string): never {
    this.cause = (code & 0x1f) << 2;
    this.epc = this.pc;
    throw new Error(message);
  }

  private execute(instr: Instr): { syscall?: SyscallKind; error?: string } {
    const { op, args } = instr;
    let nextPc = this.pc + 4;
    const R = (token: string) => this.reg(this.regOf(token));
    const setR = (token: string, value: number) => this.setReg(this.regOf(token), value);

    if (op.startsWith("add.") || op.startsWith("sub.") || op.startsWith("mul.") || op.startsWith("div.")) {
      this.executeFloatArithmetic(op, args);
      this.pc = nextPc;
      return {};
    }
    if (op.startsWith("c.") && /\.(s|d)$/.test(op)) {
      this.executeFloatCompare(op, args);
      this.pc = nextPc;
      return {};
    }

    switch (op) {
      case "add": setR(args[0], this.addWithOverflow(R(args[1]), R(args[2]), "add")); break;
      case "addu": setR(args[0], (R(args[1]) + R(args[2])) | 0); break;
      case "sub": setR(args[0], this.subWithOverflow(R(args[1]), R(args[2]))); break;
      case "subu": setR(args[0], (R(args[1]) - R(args[2])) | 0); break;
      case "and": setR(args[0], R(args[1]) & R(args[2])); break;
      case "or": setR(args[0], R(args[1]) | R(args[2])); break;
      case "xor": setR(args[0], R(args[1]) ^ R(args[2])); break;
      case "nor": setR(args[0], ~(R(args[1]) | R(args[2]))); break;
      case "slt": setR(args[0], R(args[1]) < R(args[2]) ? 1 : 0); break;
      case "sltu": setR(args[0], (R(args[1]) >>> 0) < (R(args[2]) >>> 0) ? 1 : 0); break;

      case "sll": setR(args[0], R(args[1]) << (parseIntLiteral(args[2]) ?? 0)); break;
      case "srl": setR(args[0], R(args[1]) >>> (parseIntLiteral(args[2]) ?? 0)); break;
      case "sra": setR(args[0], R(args[1]) >> (parseIntLiteral(args[2]) ?? 0)); break;
      case "sllv": setR(args[0], R(args[1]) << (R(args[2]) & 0x1f)); break;
      case "srlv": setR(args[0], R(args[1]) >>> (R(args[2]) & 0x1f)); break;
      case "srav": setR(args[0], R(args[1]) >> (R(args[2]) & 0x1f)); break;

      case "addi": setR(args[0], this.addWithOverflow(R(args[1]), this.resolveImmOrLabel(args[2]) | 0, "addi")); break;
      case "addiu": setR(args[0], (R(args[1]) + (this.resolveImmOrLabel(args[2]) | 0)) | 0); break;
      case "andi": setR(args[0], R(args[1]) & (this.resolveImmOrLabel(args[2]) & 0xffff)); break;
      case "ori": setR(args[0], R(args[1]) | (this.resolveImmOrLabel(args[2]) & 0xffff)); break;
      case "xori": setR(args[0], R(args[1]) ^ (this.resolveImmOrLabel(args[2]) & 0xffff)); break;
      case "slti": setR(args[0], R(args[1]) < (this.resolveImmOrLabel(args[2]) | 0) ? 1 : 0); break;
      case "sltiu": setR(args[0], (R(args[1]) >>> 0) < ((this.resolveImmOrLabel(args[2]) | 0) >>> 0) ? 1 : 0); break;
      case "lui": setR(args[0], (this.resolveImmOrLabel(args[1]) & 0xffff) << 16); break;

      case "beq": if (R(args[0]) === R(args[1])) nextPc = this.resolveBranchTarget(args[2]); break;
      case "bne": if (R(args[0]) !== R(args[1])) nextPc = this.resolveBranchTarget(args[2]); break;
      case "blez": if (R(args[0]) <= 0) nextPc = this.resolveBranchTarget(args[1]); break;
      case "bgtz": if (R(args[0]) > 0) nextPc = this.resolveBranchTarget(args[1]); break;
      case "bltz": if (R(args[0]) < 0) nextPc = this.resolveBranchTarget(args[1]); break;
      case "bgez": if (R(args[0]) >= 0) nextPc = this.resolveBranchTarget(args[1]); break;
      case "bc1t": if (this.fpCondition) nextPc = this.resolveBranchTarget(args[0]); break;
      case "bc1f": if (!this.fpCondition) nextPc = this.resolveBranchTarget(args[0]); break;

      case "j": nextPc = this.resolveJumpTarget(args[0]); break;
      case "jal": this.setReg(31, this.pc + 8); nextPc = this.resolveJumpTarget(args[0]); break;
      case "jr": nextPc = R(args[0]); break;
      case "jalr": {
        const targetToken = args.length === 1 ? args[0] : args[1];
        const linkRegister = args.length === 1 ? 31 : this.regOf(args[0]);
        const target = R(targetToken);
        this.setReg(linkRegister, this.pc + 8);
        nextPc = target;
        break;
      }

      case "lw": {
        const address = this.effectiveAddress(args, R);
        setR(args[0], this.readWord(address, "lw"));
        break;
      }
      case "sw": {
        const address = this.effectiveAddress(args, R);
        this.writeWord(address, R(args[0]), "sw");
        break;
      }
      case "ll": {
        const address = this.effectiveAddress(args, R);
        setR(args[0], this.readWord(address, "ll"));
        this.reservationAddr = address;
        break;
      }
      case "sc": {
        const address = this.effectiveAddress(args, R);
        this.requireAlignment(address, 4, "sc");
        const atomic = this.reservationAddr !== null && (this.reservationAddr >>> 0) === (address >>> 0);
        this.reservationAddr = null;
        if (atomic) this.memory.writeWord(address, R(args[0]));
        setR(args[0], atomic ? 1 : 0);
        break;
      }
      case "lh": {
        const address = this.effectiveAddress(args, R);
        setR(args[0], this.readHalf(address, "lh"));
        break;
      }
      case "lhu": {
        const address = this.effectiveAddress(args, R);
        setR(args[0], this.readHalf(address, "lhu") & 0xffff);
        break;
      }
      case "sh": {
        const address = this.effectiveAddress(args, R);
        this.writeHalf(address, R(args[0]), "sh");
        break;
      }
      case "lb": {
        const address = this.effectiveAddress(args, R);
        const value = this.memory.readByte(address);
        setR(args[0], value << 24 >> 24);
        break;
      }
      case "lbu": {
        const address = this.effectiveAddress(args, R);
        setR(args[0], this.memory.readByte(address));
        break;
      }
      case "sb": {
        const address = this.effectiveAddress(args, R);
        this.writeByte(address, R(args[0]));
        break;
      }

      case "mult": {
        const product = BigInt(R(args[0])) * BigInt(R(args[1]));
        this.lo = Number(BigInt.asIntN(32, product));
        this.hi = Number(BigInt.asIntN(32, product >> BigInt(32)));
        break;
      }
      case "multu": {
        const product = BigInt(R(args[0]) >>> 0) * BigInt(R(args[1]) >>> 0);
        this.lo = Number(BigInt.asUintN(32, product)) | 0;
        this.hi = Number(BigInt.asUintN(32, product >> BigInt(32))) | 0;
        break;
      }
      case "div":
        if (R(args[1]) !== 0) {
          this.lo = (R(args[0]) / R(args[1])) | 0;
          this.hi = R(args[0]) % R(args[1]);
        }
        break;
      case "divu":
        if (R(args[1]) !== 0) {
          this.lo = ((R(args[0]) >>> 0) / (R(args[1]) >>> 0)) | 0;
          this.hi = ((R(args[0]) >>> 0) % (R(args[1]) >>> 0)) | 0;
        }
        break;
      case "mfhi": setR(args[0], this.hi); break;
      case "mflo": setR(args[0], this.lo); break;
      case "mthi": this.hi = R(args[0]); break;
      case "mtlo": this.lo = R(args[0]); break;

      case "lwc1": {
        const address = this.effectiveAddress(args, R);
        this.requireAlignment(address, 4, "lwc1");
        this.writeFpSingle(this.fpRegOf(args[0]), this.memory.readFloat32(address));
        break;
      }
      case "ldc1": {
        const address = this.effectiveAddress(args, R);
        this.requireAlignment(address, 8, "ldc1");
        this.writeFpDouble(this.fpRegOf(args[0]), this.memory.readFloat64(address));
        break;
      }
      case "swc1": {
        const address = this.effectiveAddress(args, R);
        this.requireAlignment(address, 4, "swc1");
        this.invalidateReservation(address);
        this.memory.writeFloat32(address, this.fregs[this.fpRegOf(args[0])]);
        break;
      }
      case "sdc1": {
        const address = this.effectiveAddress(args, R);
        this.requireAlignment(address, 8, "sdc1");
        this.invalidateReservation(address);
        this.memory.writeFloat64(address, this.readFpDouble(this.fpRegOf(args[0])));
        break;
      }

      case "mfc0": {
        const control = parseIntLiteral(args[1]);
        const controlIndex = control ?? this.regOf(args[1]);
        setR(args[0], this.controlRegister(controlIndex));
        break;
      }
      case "__la": setR(args[0], this.resolveImmOrLabel(args[1])); break;

      case "break": this.raiseException(9, "Breakpoint exception"); break;
      case "sync": break;

      case "syscall": {
        const code = this.reg(2); // $v0
        const syscall = this.doSyscall(code);
        this.pc = nextPc;
        if (syscall?.kind === "read_int" || syscall?.kind === "read_string") this.pendingSyscall = syscall;
        else this.pendingSyscall = null;
        if (syscall?.kind === "exit") this.halted = true;
        return { syscall: syscall ?? undefined };
      }

      default:
        throw new Error(`Unimplemented instruction '${op}'`);
    }

    this.pc = nextPc;
    return {};
  }

  private doSyscall(code: number): SyscallKind | null {
    switch (code) {
      case 1: return { kind: "print_int", value: this.reg(4) };
      case 4: return { kind: "print_string", value: this.memory.readCString(this.reg(4)) };
      case 5: return { kind: "read_int" };
      case 8: return { kind: "read_string", maxLen: this.reg(5), addr: this.reg(4) };
      case 10: return { kind: "exit", code: 0 };
      case 11: return { kind: "print_char", value: String.fromCharCode(this.reg(4) & 0xff) };
      case 17: return { kind: "exit", code: this.reg(4) };
      default: return { kind: "unknown", code };
    }
  }

  /** Supplies the result of a blocking syscall (read_int / read_string) and resumes. */
  resolveSyscallInput(value: number | string) {
    if (this.pendingSyscall?.kind === "read_int" && typeof value === "number") {
      this.setReg(2, value | 0);
    }
    this.pendingSyscall = null;
  }
}
