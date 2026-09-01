import { Memory, STACK_BASE, TEXT_BASE } from "./memory";
import { resolveRegister } from "./registers";
import type { AssembledProgram, Instr } from "./assembler";
import { parseMemOperand, parseIntLiteral } from "./assembler";
import type { SyscallKind } from "./types";

export class CPU {
  regs = new Int32Array(32);
  pc = TEXT_BASE;
  hi = 0;
  lo = 0;
  memory: Memory;
  program: AssembledProgram;
  halted = false;
  pendingSyscall: SyscallKind | null = null;
  private instrByAddr: Map<number, Instr>;

  constructor(program: AssembledProgram, memory: Memory) {
    this.program = program;
    this.memory = memory;
    this.instrByAddr = new Map();
    for (const instr of program.instructions) this.instrByAddr.set(instr.addr, instr);
    this.regs[29] = STACK_BASE; // $sp
    this.pc = program.entry;
  }

  reg(i: number): number {
    return i === 0 ? 0 : this.regs[i];
  }

  setReg(i: number, v: number) {
    if (i !== 0) this.regs[i] = v | 0;
  }

  private regOf(token: string): number {
    const i = resolveRegister(token);
    if (i === null) throw new Error(`Invalid register '${token}'`);
    return i;
  }

  private resolveImmOrLabel(tok: string): number {
    const n = parseIntLiteral(tok);
    if (n !== null) return n;
    const lbl = this.program.labels.get(tok);
    if (lbl !== undefined) return lbl;
    throw new Error(`Unresolved symbol '${tok}'`);
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
      return { error: `PC 0x${this.pc.toString(16)} is out of program range` };
    }
    try {
      return this.execute(instr);
    } catch (e) {
      this.halted = true;
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  private execute(instr: Instr): { syscall?: SyscallKind; error?: string } {
    const { op, args } = instr;
    let nextPc = this.pc + 4;

    const R = (t: string) => this.reg(this.regOf(t));
    const setR = (t: string, v: number) => this.setReg(this.regOf(t), v);

    switch (op) {
      case "add": setR(args[0], (R(args[1]) + R(args[2])) | 0); break;
      case "addu": setR(args[0], (R(args[1]) + R(args[2])) | 0); break;
      case "sub": setR(args[0], (R(args[1]) - R(args[2])) | 0); break;
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

      case "addi": setR(args[0], (R(args[1]) + (this.resolveImmOrLabel(args[2]) | 0)) | 0); break;
      case "addiu": setR(args[0], (R(args[1]) + (this.resolveImmOrLabel(args[2]) | 0)) | 0); break;
      case "andi": setR(args[0], R(args[1]) & (this.resolveImmOrLabel(args[2]) & 0xffff)); break;
      case "ori": setR(args[0], R(args[1]) | (this.resolveImmOrLabel(args[2]) & 0xffff)); break;
      case "xori": setR(args[0], R(args[1]) ^ (this.resolveImmOrLabel(args[2]) & 0xffff)); break;
      case "slti": setR(args[0], R(args[1]) < this.resolveImmOrLabel(args[2]) ? 1 : 0); break;
      case "sltiu": setR(args[0], (R(args[1]) >>> 0) < (this.resolveImmOrLabel(args[2]) >>> 0) ? 1 : 0); break;
      case "lui": setR(args[0], (this.resolveImmOrLabel(args[1]) & 0xffff) << 16); break;

      case "beq": if (R(args[0]) === R(args[1])) nextPc = this.resolveImmOrLabel(args[2]); break;
      case "bne": if (R(args[0]) !== R(args[1])) nextPc = this.resolveImmOrLabel(args[2]); break;
      case "blez": if (R(args[0]) <= 0) nextPc = this.resolveImmOrLabel(args[1]); break;
      case "bgtz": if (R(args[0]) > 0) nextPc = this.resolveImmOrLabel(args[1]); break;
      case "bltz": if (R(args[0]) < 0) nextPc = this.resolveImmOrLabel(args[1]); break;
      case "bgez": if (R(args[0]) >= 0) nextPc = this.resolveImmOrLabel(args[1]); break;

      case "j": nextPc = this.resolveImmOrLabel(args[0]); break;
      case "jal": this.setReg(31, this.pc + 4); nextPc = this.resolveImmOrLabel(args[0]); break;
      case "jr": nextPc = R(args[0]); break;
      case "jalr": {
        const target = R(args[0]);
        const linkReg = args.length > 1 ? args[1] : args[0];
        this.setReg(args.length > 1 ? this.regOf(args[0]) : 31, this.pc + 4);
        nextPc = target;
        break;
      }

      case "lw": {
        const { imm, reg } = parseMemOperand(args[1])!;
        setR(args[0], this.memory.readWord(R(reg) + this.resolveImmOrLabel(imm)));
        break;
      }
      case "sw": {
        const { imm, reg } = parseMemOperand(args[1])!;
        this.memory.writeWord(R(reg) + this.resolveImmOrLabel(imm), R(args[0]));
        break;
      }
      case "lh": {
        const { imm, reg } = parseMemOperand(args[1])!;
        setR(args[0], this.memory.readHalf(R(reg) + this.resolveImmOrLabel(imm)));
        break;
      }
      case "lhu": {
        const { imm, reg } = parseMemOperand(args[1])!;
        setR(args[0], this.memory.readHalf(R(reg) + this.resolveImmOrLabel(imm)) & 0xffff);
        break;
      }
      case "sh": {
        const { imm, reg } = parseMemOperand(args[1])!;
        this.memory.writeHalf(R(reg) + this.resolveImmOrLabel(imm), R(args[0]));
        break;
      }
      case "lb": {
        const { imm, reg } = parseMemOperand(args[1])!;
        const b = this.memory.readByte(R(reg) + this.resolveImmOrLabel(imm));
        setR(args[0], b << 24 >> 24);
        break;
      }
      case "lbu": {
        const { imm, reg } = parseMemOperand(args[1])!;
        setR(args[0], this.memory.readByte(R(reg) + this.resolveImmOrLabel(imm)));
        break;
      }
      case "sb": {
        const { imm, reg } = parseMemOperand(args[1])!;
        this.memory.writeByte(R(reg) + this.resolveImmOrLabel(imm), R(args[0]));
        break;
      }

      case "mult": {
        const r = BigInt(R(args[0])) * BigInt(R(args[1]));
        this.lo = Number(BigInt.asIntN(32, r));
        this.hi = Number(BigInt.asIntN(32, r >> BigInt(32)));
        break;
      }
      case "multu": {
        const r = BigInt(R(args[0]) >>> 0) * BigInt(R(args[1]) >>> 0);
        this.lo = Number(BigInt.asUintN(32, r)) | 0;
        this.hi = Number(BigInt.asUintN(32, r >> BigInt(32))) | 0;
        break;
      }
      case "div":
        if (R(args[1]) !== 0) { this.lo = (R(args[0]) / R(args[1])) | 0; this.hi = R(args[0]) % R(args[1]); }
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

      case "__la": setR(args[0], this.resolveImmOrLabel(args[1])); break;

      case "syscall": {
        const code = this.reg(2); // $v0
        const sc = this.doSyscall(code);
        this.pc = nextPc;
        if (sc && sc.kind === "exit") this.halted = true;
        return { syscall: sc ?? undefined };
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
    if (typeof value === "number") {
      this.setReg(2, value | 0); // $v0
    } else {
      // caller already wrote the string into memory for read_string
    }
  }
}
