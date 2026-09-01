// Sparse byte-addressable memory for the MIPS simulator (little-endian).

export const TEXT_BASE = 0x00400000;
export const DATA_BASE = 0x10010000;
export const STACK_BASE = 0x7ffffffc; // initial $sp, grows down
export const HEAP_BASE = 0x10040000; // reserved for future sbrk-style alloc

export class Memory {
  private bytes = new Map<number, number>();

  reset() {
    this.bytes.clear();
  }

  readByte(addr: number): number {
    return this.bytes.get(addr >>> 0) ?? 0;
  }

  writeByte(addr: number, value: number) {
    this.bytes.set(addr >>> 0, value & 0xff);
  }

  readHalf(addr: number): number {
    const lo = this.readByte(addr);
    const hi = this.readByte(addr + 1);
    let v = (hi << 8) | lo;
    if (v & 0x8000) v -= 0x10000;
    return v;
  }

  writeHalf(addr: number, value: number) {
    this.writeByte(addr, value & 0xff);
    this.writeByte(addr + 1, (value >> 8) & 0xff);
  }

  readWord(addr: number): number {
    const b0 = this.readByte(addr);
    const b1 = this.readByte(addr + 1);
    const b2 = this.readByte(addr + 2);
    const b3 = this.readByte(addr + 3);
    return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) | 0;
  }

  writeWord(addr: number, value: number) {
    this.writeByte(addr, value & 0xff);
    this.writeByte(addr + 1, (value >>> 8) & 0xff);
    this.writeByte(addr + 2, (value >>> 16) & 0xff);
    this.writeByte(addr + 3, (value >>> 24) & 0xff);
  }

  writeString(addr: number, str: string, nullTerminate: boolean) {
    let a = addr;
    for (let i = 0; i < str.length; i++) {
      this.writeByte(a, str.charCodeAt(i));
      a++;
    }
    if (nullTerminate) this.writeByte(a, 0);
  }

  readCString(addr: number, maxLen = 65536): string {
    let s = "";
    let a = addr;
    for (let i = 0; i < maxLen; i++) {
      const b = this.readByte(a);
      if (b === 0) break;
      s += String.fromCharCode(b);
      a++;
    }
    return s;
  }

  // Returns sorted list of [addr, byte] touched in a range, for the memory viewer.
  dumpRange(start: number, count: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(this.readByte(start + i));
    return out;
  }
}
