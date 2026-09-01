// MIPS register name -> index mapping ($0-$31 plus ABI names)

export const REGISTER_NAMES = [
  "zero", "at", "v0", "v1", "a0", "a1", "a2", "a3",
  "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7",
  "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7",
  "t8", "t9", "k0", "k1", "gp", "sp", "fp", "ra",
];

const NAME_TO_INDEX: Record<string, number> = {};
REGISTER_NAMES.forEach((n, i) => {
  NAME_TO_INDEX[n] = i;
});

export function resolveRegister(token: string): number | null {
  if (!token) return null;
  let t = token.trim();
  if (!t.startsWith("$")) return null;
  t = t.slice(1);
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    if (n >= 0 && n <= 31) return n;
    return null;
  }
  if (t in NAME_TO_INDEX) return NAME_TO_INDEX[t];
  return null;
}

export function registerLabel(index: number): string {
  return "$" + REGISTER_NAMES[index];
}
