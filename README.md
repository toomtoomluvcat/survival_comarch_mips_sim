# อัปเดตประจำวัน (10 กันยายน 2026): ปรับปรุง MIPS engine ให้สอดคล้องกับ EMIPS Reference Card โดยรองรับ Big Endian, memory layout, atomic instructions, floating-point instructions และ exception handling เบื้องต้น

# MIPS Simulator

จำลองการทำงานของ CPU สถาปัตยกรรม **MIPS32** ผ่านเว็บเบราว์เซอร์ หน้าตาเป็น IDE สไตล์ **Classic Mac OS** (System 7 / Mac OS 9) เขียนหน้าโปรแกรม เปิด/บันทึกไฟล์ แล้ว assemble + รันโปรแกรม MIPS assembly ดูค่าใน register และหน่วยความจำแบบ real-time ได้ทั้งหมดในเบราว์เซอร์ โดยไม่ต้องติดตั้งโปรแกรมจำลองแยกต่างหาก (ไม่ต้องมี backend/server ประมวลผล — รันฝั่ง client ล้วนๆ)

![status](https://img.shields.io/badge/status-work--in--progress-yellow)

---

## สารบัญ

- [ภาพรวมโปรเจกต์](#ภาพรวมโปรเจกต์)
- [ฟีเจอร์หลัก](#ฟีเจอร์หลัก)
- [เทคโนโลยีที่ใช้](#เทคโนโลยีที่ใช้)
- [เริ่มต้นใช้งาน (Setup)](#เริ่มต้นใช้งาน-setup)
- [วิธีใช้งานหน้าจอ IDE](#วิธีใช้งานหน้าจอ-ide)
- [ชุดคำสั่ง MIPS ที่รองรับ](#ชุดคำสั่ง-mips-ที่รองรับ)
- [Syscall ที่รองรับ](#syscall-ที่รองรับ)
- [Directive ของ Assembler](#directive-ของ-assembler)
- [ตัวอย่างโปรแกรม](#ตัวอย่างโปรแกรม)
- [โครงสร้างโปรเจกต์](#โครงสร้างโปรเจกต์)
- [สถาปัตยกรรมการทำงานภายใน](#สถาปัตยกรรมการทำงานภายใน)
- [ข้อจำกัดที่ควรรู้](#ข้อจำกัดที่ควรรู้)
- [แผนที่อาจทำต่อ (Roadmap)](#แผนที่อาจทำต่อ-roadmap)

---

## ภาพรวมโปรเจกต์

โปรเจกต์นี้แบ่งเป็น 2 ส่วนหลักที่แยกอิสระจากกัน:

1. **MIPS Engine** (`lib/mips/`) — ตัวแปลภาษา (assembler) และตัวจำลอง CPU (simulator) เขียนด้วย TypeScript ล้วน ไม่ผูกกับ UI จึงทดสอบและนำไปใช้ที่อื่นได้อิสระ
2. **หน้า IDE** (`app/`, `components/`) — ส่วนติดต่อผู้ใช้สไตล์ Classic Mac OS ที่เรียกใช้ MIPS Engine ผ่าน React hook (`lib/useSimulator.ts`)

เหมาะสำหรับใช้เรียนรู้/สอนวิชา Computer Organization & Architecture, ทดลองเขียนโปรแกรม MIPS assembly แบบไม่ต้องติดตั้ง MARS/SPIM หรือใช้ทวนความเข้าใจเรื่อง register, memory addressing, และ syscall ของ MIPS

## ฟีเจอร์หลัก

### 1. หน้าตาแบบ IDE
- **Menu bar** ด้านบนสุดของจอ (File / Run / Help) แบบ Mac OS ของแท้
- **หน้าต่างลอย (window chrome)** สไตล์ Mac OS — title bar ลาย pinstripe, close box, เงาตกกระทบ
- แบ่งพื้นที่เป็น 4 หน้าต่าง: **Editor**, **Registers**, **Memory**, **Console**

### 2. Editor
- เขียนโค้ด MIPS assembly พร้อมเลขบรรทัด (gutter)
- ไฮไลต์บรรทัดที่กำลังรันอยู่ (สีเหลือง) แบบ real-time ขณะ Step/Run
- ไฮไลต์บรรทัดที่มี error หลัง assemble ไม่ผ่าน (สีแดง) พร้อมข้อความ error ใน Console

### 3. การจัดการไฟล์
| ปุ่ม/เมนู | หน้าที่ |
|---|---|
| **New** | เริ่มไฟล์ใหม่ (มี confirm ก่อนล้างโค้ดเดิม) |
| **Open…** | เลือกไฟล์ `.asm` / `.s` / `.txt` / `.mips` จากเครื่องมาโหลดใส่ editor |
| **Save As…** | ดาวน์โหลดโค้ดปัจจุบันเป็นไฟล์ข้อความ |

> หมายเหตุ: การเปิด/บันทึกไฟล์ทำงานผ่าน File API ของเบราว์เซอร์ล้วนๆ (ไม่มีการอัปโหลดไฟล์ขึ้นเซิร์ฟเวอร์ใดๆ)

### 4. การรันโปรแกรม
| ปุ่ม/เมนู | Shortcut | หน้าที่ |
|---|---|---|
| **Assemble** | ⌘K | แปลโค้ดเป็นชุดคำสั่งภายใน ตรวจ syntax error โดยยังไม่รัน |
| **▶ Run** | **Ctrl/Cmd + Enter** | Assemble ให้อัตโนมัติแล้วรันจนจบในคลิกเดียว/ปุ่มเดียว ไม่ต้องกด Assemble แยกก่อน |
| **⏭ Step** | ⌘. | รันทีละ 1 คำสั่ง เห็นค่าที่เปลี่ยนใน register ทันที |
| **■ Stop** | — | หยุดโปรแกรมที่กำลังรันอยู่ (กันเคส infinite loop) |
| **↺ Reset** | — | ล้างค่า register/memory กลับไป assemble โค้ดปัจจุบันใหม่ |

โปรแกรมมีลิมิตจำนวนคำสั่งสูงสุด (5,000,000 คำสั่ง) เพื่อป้องกัน browser ค้างถ้าโค้ดเข้า infinite loop โดยไม่ตั้งใจ

### 5. หน้าต่าง Registers
- แสดงค่า `$0`–`$31` (ทั้งชื่อเลขและชื่อ ABI เช่น `$8 (t0)`) รวมถึง `PC`, `HI`, `LO`
- สลับดูเป็น **hex** หรือ **decimal** ได้
- ไฮไลต์ (พื้นสีฟ้า) register ที่ค่าเปลี่ยนจากการ Step ล่าสุด ช่วยตามการทำงานทีละคำสั่งได้ง่าย

### 6. หน้าต่าง Memory
- ดู memory แบบ hex dump ทีละ 8 ไบต์ต่อแถว พร้อมคอลัมน์ ASCII
- ใส่ address ที่ต้องการดูเองได้ (ช่อง `addr`) หรือกดปุ่ม `.data` เพื่อกระโดดไปจุดเริ่มต้นของ `.data` segment

### 7. หน้าต่าง Console
- แสดงผลลัพธ์จาก syscall (`print_int`, `print_string`, `print_char`)
- แสดงข้อความ error ของ assembler (บรรทัดที่ผิดและสาเหตุ)
- รองรับ syscall แบบ **blocking input** (`read_int`, `read_string`) — เมื่อโปรแกรมเรียกอ่านค่า จะเด้ง dialog กล่องข้อความสไตล์ Mac OS ให้กรอกค่า แล้ว "OK" เพื่อให้โปรแกรมทำงานต่อ

## เทคโนโลยีที่ใช้

- **Next.js 16** (App Router) + **React 19**
- **TypeScript** (strict) — ทั้ง UI และ MIPS engine
- **Plain CSS** (ไม่ใช้ UI framework ภายนอก) ออกแบบธีม Classic Mac OS เองทั้งหมดใน `app/globals.css`
- ไม่มี state management library ภายนอก ใช้ React hook (`useState`/`useRef`/custom hook) ล้วนๆ

## เริ่มต้นใช้งาน (Setup)

ต้องมี [Node.js](https://nodejs.org/) เวอร์ชัน 18 ขึ้นไป

```bash
cd mips-simulator
npm install
npm run dev
```

เปิดเบราว์เซอร์ไปที่ [http://localhost:3000](http://localhost:3000)

คำสั่งอื่นที่มีประโยชน์:

```bash
npm run build   # build production
npm run start   # รัน production build
npm run lint    # ตรวจ ESLint
npx tsc --noEmit -p .   # ตรวจ TypeScript type อย่างเดียว
```

## วิธีใช้งานหน้าจอ IDE

1. เปิดเว็บมาจะมีโปรแกรมตัวอย่างใส่มาให้แล้ว (พิมพ์ "Hello, world!" แล้วบวกเลข 1 ถึง 10)
2. แก้ไข/เขียนโค้ดในหน้าต่าง Editor (ตรงกลาง-ซ้าย)
3. กด **▶ Run** (หรือ **Ctrl+Enter**) เพื่อ assemble แล้วรันทันที
4. ถ้า assemble ไม่ผ่าน จะเห็นบรรทัดที่ผิดถูกไฮไลต์สีแดงในโค้ด และรายละเอียด error ในหน้าต่าง Console
5. ถ้าอยากดูการทำงานทีละคำสั่ง ใช้ **⏭ Step** แทน — จะเห็นบรรทัดปัจจุบันไฮไลต์สีเหลือง และ register ที่เพิ่งเปลี่ยนไฮไลต์สีฟ้า
6. ถ้าโปรแกรมเรียก syscall อ่านค่า (`read_int` / `read_string`) จะมี popup ให้กรอกค่า กด OK แล้วโปรแกรมทำงานต่ออัตโนมัติ (ถ้ากดผ่าน "Run" ต้องกด Run ซ้ำอีกครั้งเพื่อรันส่วนที่เหลือหลังกรอกค่า)
7. ใช้เมนู **File** เพื่อเปิดไฟล์ `.asm` จากเครื่อง หรือบันทึกโค้ดปัจจุบันเป็นไฟล์

## ชุดคำสั่ง MIPS ที่รองรับ

### คำสั่งจริง (real instructions)

| หมวด | คำสั่ง |
|---|---|
| Arithmetic / Logic (R-type) | `add`, `addu`, `sub`, `subu`, `and`, `or`, `xor`, `nor`, `slt`, `sltu` |
| Arithmetic / Logic แบบ immediate | `addi`, `addiu`, `andi`, `ori`, `xori`, `slti`, `sltiu`, `lui` |
| Shift | `sll`, `srl`, `sra`, `sllv`, `srlv`, `srav` |
| Branch | `beq`, `bne`, `blez`, `bgtz`, `bltz`, `bgez` |
| Jump | `j`, `jal`, `jr`, `jalr` |
| Load/Store หน่วยความจำ | `lw`, `sw`, `lb`, `lbu`, `sb`, `lh`, `lhu`, `sh`, `ll`, `sc` |
| Multiply/Divide | `mult`, `multu`, `div`, `divu`, `mfhi`, `mflo`, `mthi`, `mtlo` |
| Floating point (Cop1) | `add.s`, `add.d`, `sub.s`, `sub.d`, `mul.s`, `mul.d`, `div.s`, `div.d`, `c.eq.s`, `c.lt.s`, `c.le.s`, `c.eq.d`, `c.lt.d`, `c.le.d`, `lwc1`, `ldc1`, `swc1`, `sdc1`, `bc1t`, `bc1f` |
| Control / system | `mfc0`, `syscall`, `break`, `sync` |

### Pseudo-instructions (assembler ขยายให้อัตโนมัติ)

`li`, `la`, `move`, `nop`, `b`, `beqz`, `bnez`, `not`, `neg`, `blt`, `bgt`, `ble`, `bge`, `bltu`, `bgtu`, `bleu`, `bgeu`, `seq`, `sne`

> คำสั่งเปรียบเทียบแบบ pseudo (`blt`/`bgt`/`ble`/`bge` และรุ่น unsigned) รองรับทั้งกรณีเทียบกับ **register** และเทียบกับ **ค่าคงที่** เช่น `bgt $t0, 10, done` ได้โดยตรง (assembler จะแทรกคำสั่งโหลดค่าคงที่ลง `$at`/`$k1` ให้อัตโนมัติ)

คำสั่ง `add`/`addi`/`sub` จะรายงาน arithmetic overflow และคำสั่ง load/store แบบ word หรือ halfword จะรายงาน Address Error เมื่อ address ไม่ได้ aligned ตามขนาดข้อมูล

## Syscall ที่รองรับ

อิงตามธรรมเนียมของ MARS/SPIM (ใส่ syscall code ใน `$v0` ก่อนเรียก `syscall`)

| `$v0` | ชื่อ | อาร์กิวเมนต์ | ผลลัพธ์ |
|---|---|---|---|
| 1 | print_int | `$a0` = เลขจำนวนเต็ม | พิมพ์เลขออก Console |
| 4 | print_string | `$a0` = address ของ null-terminated string | พิมพ์ข้อความออก Console |
| 5 | read_int | — | หยุดรอผู้ใช้กรอกเลขผ่าน popup แล้วเก็บผลลัพธ์ใน `$v0` |
| 8 | read_string | `$a0` = address ปลายทาง, `$a1` = ความยาวสูงสุด | หยุดรอผู้ใช้กรอกข้อความผ่าน popup แล้วเขียนลง memory |
| 10 | exit | — | จบโปรแกรม |
| 11 | print_char | `$a0` = รหัสอักขระ | พิมพ์ตัวอักษรออก Console |
| 17 | exit2 | `$a0` = exit code | จบโปรแกรมพร้อมรหัส |

syscall code อื่นที่ยังไม่รองรับจะขึ้นข้อความ `[unsupported syscall $v0=...]` ใน Console แล้วโปรแกรมทำงานต่อ (ไม่ค้าง)

## Directive ของ Assembler

- ส่วนโปรแกรม: `.text`, `.data`
- ข้อมูล: `.word`, `.half`, `.byte`, `.ascii`, `.asciiz`, `.space`, `.align`
- อื่นๆ ที่รับแต่ไม่มีผล (ผ่านเฉยๆ เพื่อความเข้ากันได้): `.globl` / `.global`

Address เริ่มต้น (อิงตาม MIPS Reference Data Card ใน `EMIPS.pdf`):
- `.text` เริ่มที่ `0x00400000`
- `.data` เริ่มที่ `0x10000000`
- `$gp` เริ่มต้นที่ `0x10008000`
- `$sp` เริ่มต้นที่ `0x7ffffffc` (stack โตลง)

หน่วยความจำแบบหลายไบต์ใช้ลำดับ **Big Endian** ตามส่วน Data Alignment ของเอกสาร

ถ้ามี label ชื่อ `main` โปรแกรมจะเริ่มรันจาก label นั้น ถ้าไม่มีจะเริ่มรันจากคำสั่งแรกของ `.text`

## ตัวอย่างโปรแกรม

```mips
# พิมพ์ "Hello, world!" แล้วบวกเลข 1 ถึง 10
        .data
hello:  .asciiz "Hello, world!\n"
sumMsg: .asciiz "Sum 1..10 = "
nl:     .asciiz "\n"

        .text
main:
        li   $v0, 4
        la   $a0, hello
        syscall

        li   $t0, 1        # i = 1
        li   $t1, 0        # sum = 0
loop:
        bgt  $t0, 10, done
        add  $t1, $t1, $t0
        addi $t0, $t0, 1
        b    loop
done:
        li   $v0, 4
        la   $a0, sumMsg
        syscall

        li   $v0, 1
        add  $a0, $t1, $zero
        syscall

        li   $v0, 4
        la   $a0, nl
        syscall

        li   $v0, 10
        syscall
```

ผลลัพธ์ที่ควรเห็นใน Console:

```
Hello, world!
Sum 1..10 = 55
[program exited]
```

โปรแกรมตัวอย่างนี้ถูกใส่มาให้อัตโนมัติเมื่อเปิดหน้าเว็บครั้งแรก (ดูได้ที่ `lib/sample.ts`)

## โครงสร้างโปรเจกต์

```
mips-simulator/
├── app/
│   ├── layout.tsx        # root layout + metadata
│   ├── page.tsx           # หน้า IDE หลัก ประกอบทุกส่วนเข้าด้วยกัน
│   └── globals.css        # ธีม Classic Mac OS ทั้งหมด (window chrome, ปุ่ม, ฟอนต์ ฯลฯ)
├── components/
│   ├── MenuBar.tsx         # แถบเมนูบนสุด + dropdown
│   ├── MacWindow.tsx        # กรอบหน้าต่างสไตล์ Mac OS (ใช้ห่อทุกพาเนล)
│   ├── Toolbar.tsx           # แถบปุ่ม New/Open/Save/Assemble/Run/Step/Stop/Reset
│   ├── CodeEditor.tsx         # editor พร้อมเลขบรรทัดและไฮไลต์
│   ├── RegistersPanel.tsx      # พาเนลแสดง register
│   ├── MemoryPanel.tsx          # พาเนลแสดง memory hex dump
│   ├── ConsolePanel.tsx          # พาเนลแสดง output/error
│   └── InputModal.tsx             # popup รับค่าจาก read_int/read_string
├── lib/
│   ├── useSimulator.ts     # React hook เชื่อม UI เข้ากับ MIPS engine (state, run loop, syscall)
│   ├── sample.ts             # โค้ดตัวอย่างเริ่มต้น
│   └── mips/
│       ├── registers.ts        # ตาราง mapping ชื่อ register ↔ เลข
│       ├── memory.ts             # หน่วยความจำแบบ byte-addressable (big-endian, sparse)
│       ├── assembler.ts           # two-pass assembler: parse, ขยาย pseudo-instruction, resolve label
│       ├── cpu.ts                    # ตัวจำลอง CPU: execute ทีละคำสั่ง, จัดการ syscall
│       ├── types.ts                   # type กลางที่ใช้ร่วมกัน
│       └── index.ts                    # จุดรวม export
└── README.md
```

## สถาปัตยกรรมการทำงานภายใน

1. **Assemble**: `assemble(source)` ใน `lib/mips/assembler.ts` ทำงาน 2 pass
   - Pass 1: ไล่อ่านทีละบรรทัด แยก label/directive/instruction, ขยาย pseudo-instruction เป็นคำสั่งจริง, จัดวาง `.data` segment แบบ Big Endian พร้อมคำนวณ address ของแต่ละ label
   - Pass 2: กำหนด address ให้คำสั่งใน `.text` (เรียงตามลำดับ, คำสั่งละ 4 ไบต์) แล้วตรวจสอบความถูกต้องของ operand แต่ละคำสั่ง (จำนวน/ชนิด argument, label ที่อ้างถึงมีอยู่จริงไหม) เก็บ error พร้อมเลขบรรทัดไว้รายงานกลับ
2. **Execute**: `CPU` class ใน `lib/mips/cpu.ts` ถือ integer register file (`Int32Array` ขนาด 32), floating-point register file, `PC`, `HI/LO`, Coprocessor 0 state และอ้างถึง `Memory` instance เดียวกับที่ assembler สร้างไว้ ทำงานแบบ **step ทีละคำสั่ง** — เรียก `cpu.step()` หนึ่งครั้งเท่ากับ 1 clock ของการ fetch-decode-execute แบบง่าย
3. **Syscall handling**: เมื่อ `step()` เจอ `syscall` จะคืนค่า `SyscallKind` ให้ฝั่ง hook (`useSimulator.ts`) ไปจัดการ ถ้าเป็น syscall แบบพิมพ์ผลลัพธ์ (print_*) จะพิมพ์ต่อทันทีแล้ว step ต่อได้เลย แต่ถ้าเป็น syscall แบบรอรับข้อมูล (read_int/read_string) การทำงานจะ**หยุดรอ** จนกว่าผู้ใช้จะกรอกค่าผ่าน `InputModal` แล้วเรียก `resolveSyscallInput()` เพื่อไปต่อ
4. **Run loop**: การกด "Run" จะรันเป็น chunk ละ 20,000 คำสั่งผ่าน `setTimeout(fn, 0)` สลับกันไปเรื่อยๆ (ไม่ใช่ loop เดียวยาวๆ) เพื่อไม่ให้ UI ค้างระหว่างรันโปรแกรมที่มีคำสั่งจำนวนมาก และให้ปุ่ม Stop ตอบสนองได้จริงระหว่างรัน
5. **Reactivity**: ทุกครั้งที่ state เปลี่ยน (`step`, `run`, syscall, input) hook จะอ่านค่าจาก `cpu.regs`/`cpu.pc`/`cpu.hi`/`cpu.lo` มาแปลงเป็น React state ใหม่ (`snapshot()`) ทำให้ทุกพาเนลอัปเดตพร้อมกันแบบ synchronous กับการ execute แต่ละคำสั่ง

## ข้อจำกัดที่ควรรู้

- ยังไม่จำลอง exception control flow และคำสั่ง privileged/trap ขั้นสูงครบทุกตัว แม้จะมี `cause`, `status`, `epc` และตรวจ overflow/alignment สำหรับคำสั่งหลักแล้ว
- **ไม่ได้ encode เป็น binary จริง** — ภายในเก็บคำสั่งเป็น object `{op, args}` ไม่ใช่เลขฐานสอง 32 บิตแบบ real MIPS encoding (เหมาะกับการเรียนรู้ตรรกะของโปรแกรม แต่ไม่เหมาะถ้าต้องการดู machine code จริง)
- **Editor ยังไม่มี syntax highlighting สี** เป็น textarea ธรรมดา (ไฮไลต์เฉพาะบรรทัดปัจจุบัน/error เท่านั้น)
- **หน้าต่างไม่ลากย้ายตำแหน่งได้** (fixed layout แบบ grid) แม้หน้าตาจะเป็นสไตล์ Mac OS ก็ตาม
- จำกัดจำนวนคำสั่งที่รันต่อเนื่องได้สูงสุด 5,000,000 คำสั่งต่อการกด Run หนึ่งครั้ง เพื่อกัน infinite loop ทำให้เบราว์เซอร์ค้าง

## แผนที่อาจทำต่อ (Roadmap)

- [ ] Syntax highlighting สีในตัว editor
- [ ] หน้าต่างแบบลากย้าย/ปรับขนาดได้จริงเหมือน Mac OS ของแท้
- [ ] แสดง binary/hex encoding ของแต่ละคำสั่งจริง
- [ ] Breakpoint (คลิกที่เลขบรรทัดเพื่อตั้งจุดหยุด)
- [ ] Persist โค้ดล่าสุดไว้ใน `localStorage`

---

สร้างด้วย [Next.js](https://nextjs.org/) — ทดสอบและพัฒนาโดยใช้ AI ผ่าน Claude Code
