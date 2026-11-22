// Tiny stack VM for make.fun tiny-stack-vm-01 (ISA v1).
// Runs every /input/<id> program and writes /output/<id>/stdout.bin + exit.txt.
// Plain JavaScript (no TS-only syntax) so Node 22 type-stripping runs it as-is.
// Mount locations: the docker sandbox mounts /input and /output for real;
// the process driver instead passes their host paths in these env vars
// (grader/sandbox/types.ts MOUNT_POINTS). The values only locate the
// mounts; they never change the computation, so runs stay deterministic.
const INDIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTDIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const fs = require('node:fs');

// Stack needs per opcode: [pops, pushes]. Built from the ISA table.
const NEED = new Uint8Array(84), GIVE = new Uint8Array(84);
for (const [o, a, b] of [
  [1, 0, 1], [2, 0, 1], [3, 1, 0], [4, 1, 2], [5, 2, 2], [6, 2, 3], [7, 3, 3],
  [16, 2, 1], [17, 2, 1], [18, 2, 1], [19, 2, 1], [20, 2, 1], [21, 2, 1],
  [22, 2, 1], [23, 1, 1], [24, 2, 1], [25, 2, 1], [26, 2, 1], [27, 1, 1],
  [28, 2, 1], [29, 2, 1], [30, 2, 1], [32, 2, 1], [33, 2, 1], [34, 2, 1],
  [49, 1, 0], [50, 1, 0], [64, 1, 1], [65, 2, 0], [80, 1, 0], [81, 1, 0], [82, 0, 1],
  [83, 1, 0]
]) { NEED[o] = a; GIVE[o] = b; }

function run(p, inp) {
  const s = [], c = [], m = new Int32Array(256), o = [];
  let pc = 0, ip = 0, n = 0;
  for (;;) {
    // 1. step limit, checked BEFORE the pc check.
    if (n >= 1000000) return [o, 10];
    // 2. pc outside the program.
    if (pc < 0 || pc >= p.length) return [o, 9];
    const op = p[pc];
    // 3. unknown opcode.
    const known = op <= 7 || (op >= 16 && op <= 30) || (op >= 32 && op <= 34) || (op >= 64 && op <= 65) || (op >= 80 && op <= 83);
    if (!known) return [o, 5];
    // 4. immediate cut off by the end of the program.
    let imm = 0, len = 1;
    if (op === 1) {
      len = 2; if (pc + 2 > p.length) return [o, 9];
      imm = p[pc + 1]; if (imm > 127) imm -= 256; // PUSH8 sign-extends
    } else if (op === 2) {
      len = 5; if (pc + 5 > p.length) return [o, 9];
      imm = p.readInt32LE(pc + 1);
    } else if (op === 48 || op === 49 || op === 50) {
      len = 3; if (pc + 3 > p.length) return [o, 9];
      imm = p.readInt16LE(pc + 1); // JMP/JZ/JNZ: signed 16-bit offset
    } else if (op === 51) {
      len = 3; if (pc + 3 > p.length) return [o, 9];
      imm = p.readUInt16LE(pc + 1); // CALL: unsigned 16-bit target
    }
    // 5. execute: counts as one step; stack needs checked first.
    n++;
    if (s.length < NEED[op]) return [o, 2];
    if (s.length - NEED[op] + GIVE[op] > 256) return [o, 3];
    const next = pc + len;
    switch (op) {
      case 0: return [o, 0]; // HALT
      case 1: case 2: s.push(imm); pc = next; break;
      case 3: s.pop(); pc = next; break;
      case 4: s.push(s[s.length - 1]); pc = next; break;
      case 5: { const t = s[s.length - 1]; s[s.length - 1] = s[s.length - 2]; s[s.length - 2] = t; pc = next; break; }
      case 6: s.push(s[s.length - 2]); pc = next; break;
      case 7: { const a = s[s.length - 3]; s[s.length - 3] = s[s.length - 2]; s[s.length - 2] = s[s.length - 1]; s[s.length - 1] = a; pc = next; break; }
      case 16: { const b = s.pop(), a = s.pop(); s.push((a + b) | 0); pc = next; break; } // ADD
      case 17: { const b = s.pop(), a = s.pop(); s.push((a - b) | 0); pc = next; break; } // SUB
      case 18: { const b = s.pop(), a = s.pop(); s.push(Math.imul(a, b)); pc = next; break; } // MUL wraps
      case 19: { const b = s.pop(), a = s.pop(); if (b === 0) return [o, 4]; s.push(Math.trunc(a / b) | 0); pc = next; break; } // DIV
      case 20: { const b = s.pop(), a = s.pop(); if (b === 0) return [o, 4]; s.push((a % b) | 0); pc = next; break; } // MOD, sign of a
      case 21: { const b = s.pop(), a = s.pop(); if (b === 0) return [o, 4]; s.push(Math.floor((a >>> 0) / (b >>> 0)) | 0); pc = next; break; } // DIVU
      case 22: { const b = s.pop(), a = s.pop(); if (b === 0) return [o, 4]; s.push(((a >>> 0) % (b >>> 0)) | 0); pc = next; break; } // MODU
      case 23: s.push((-s.pop()) | 0); pc = next; break; // NEG wraps
      case 24: { const b = s.pop(), a = s.pop(); s.push(a & b); pc = next; break; } // AND
      case 25: { const b = s.pop(), a = s.pop(); s.push(a | b); pc = next; break; } // OR
      case 26: { const b = s.pop(), a = s.pop(); s.push(a ^ b); pc = next; break; } // XOR
      case 27: s.push(~s.pop()); pc = next; break; // NOT
      case 28: { const b = s.pop(), a = s.pop(); s.push(a << b); pc = next; break; } // SHL, count masked to 5 bits by JS
      case 29: { const b = s.pop(), a = s.pop(); s.push(a >> b); pc = next; break; } // SHR arithmetic
      case 30: { const b = s.pop(), a = s.pop(); s.push((a >>> b) | 0); pc = next; break; } // SHRU logical
      case 32: { const b = s.pop(), a = s.pop(); s.push(a === b ? 1 : 0); pc = next; break; } // EQ
      case 33: { const b = s.pop(), a = s.pop(); s.push(a < b ? 1 : 0); pc = next; break; } // LT signed
      case 34: { const b = s.pop(), a = s.pop(); s.push((a >>> 0) < (b >>> 0) ? 1 : 0); pc = next; break; } // LTU
      case 48: pc = next + imm; break; // JMP, target unchecked until next step
      case 49: pc = s.pop() === 0 ? next + imm : next; break; // JZ
      case 50: pc = s.pop() !== 0 ? next + imm : next; break; // JNZ
      case 51: if (c.length >= 64) return [o, 7]; c.push(next); pc = imm; break; // CALL
      case 52: if (c.length === 0) return [o, 8]; pc = c.pop(); break; // RET
      case 64: { const a = s.pop(); if (a < 0 || a > 255) return [o, 6]; s.push(m[a]); pc = next; break; } // LOAD
      case 65: { const a = s.pop(), v = s.pop(); if (a < 0 || a > 255) return [o, 6]; m[a] = v; pc = next; break; } // STORE
      case 80: { // PRINT: decimal ASCII, trap 11 writes none of its bytes
        const t = String(s.pop());
        if (o.length + t.length > 65536) return [o, 11];
        for (let i = 0; i < t.length; i++) o.push(t.charCodeAt(i));
        pc = next; break;
      }
      case 81: if (o.length + 1 > 65536) return [o, 11]; o.push(s.pop() & 255); pc = next; break; // PUTC
      case 82: s.push(ip < inp.length ? inp[ip++] : -1); pc = next; break; // IN, -1 past end
      case 83: return [o, s.pop() & 255]; // EXIT, low byte
    }
  }
}

// Entry: answer every instance in the input dir in one run.
for (const id of fs.readdirSync(INDIR).sort()) {
  const dir = INDIR + '/' + id;
  let prog, inp;
  try { prog = fs.readFileSync(dir + '/program.bin'); } catch { prog = Buffer.alloc(0); }
  try { inp = fs.readFileSync(dir + '/input.bin'); } catch { inp = Buffer.alloc(0); }
  const [out, code] = run(prog, inp);
  fs.mkdirSync(OUTDIR + '/' + id, { recursive: true });
  fs.writeFileSync(OUTDIR + '/' + id + '/stdout.bin', Buffer.from(out));
  fs.writeFileSync(OUTDIR + '/' + id + '/exit.txt', code + '\n');
}
