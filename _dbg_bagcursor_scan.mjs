import "dotenv/config";
import { executeQueue } from "./tools/inputExecutor.js";
import { readRange } from "./gamestate/emulatorInteraction/httpMemoryReader.js";

const RANGE_START = 0x02030000;
const RANGE_LEN = 0xc000; // 48KB

async function snapshot() {
    return await readRange(RANGE_START, RANGE_LEN);
}

function diff(a, b) {
    const out = [];
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) out.push({ addr: RANGE_START + i, before: a[i], after: b[i] });
    }
    return out;
}

const settle = 30;

console.log("snapshot A (baseline, bag open, cursor on CANCEL)...");
const a = await snapshot();

console.log("press up (CANCEL -> POTION)...");
await executeQueue(["up"], { tapSettleFrames: settle });
const b = await snapshot();
const diffAB = diff(a, b);
console.log(`A->B: ${diffAB.length} changed bytes`);

console.log("press up (POTION -> ANTIDOTE)...");
await executeQueue(["up"], { tapSettleFrames: settle });
const c = await snapshot();
const diffBC = diff(b, c);
console.log(`B->C: ${diffBC.length} changed bytes`);

console.log("press down (ANTIDOTE -> POTION, should reverse)...");
await executeQueue(["down"], { tapSettleFrames: settle });
const d = await snapshot();
const diffCD = diff(c, d);
console.log(`C->D: ${diffCD.length} changed bytes`);

const setAB = new Map(diffAB.map((x) => [x.addr, x]));
const setBC = new Map(diffBC.map((x) => [x.addr, x]));
const setCD = new Map(diffCD.map((x) => [x.addr, x]));

const candidates = [];
for (const addr of setAB.keys()) {
    if (setBC.has(addr) && setCD.has(addr)) {
        candidates.push({ addr, ab: setAB.get(addr), bc: setBC.get(addr), cd: setCD.get(addr) });
    }
}

console.log(`\nCandidates present in all 3 transitions: ${candidates.length}`);
for (const cnd of candidates) {
    console.log(
        `0x${cnd.addr.toString(16)}: A=${cnd.ab.before} -up-> B=${cnd.ab.after} -up-> C=${cnd.bc.after} -down-> D=${cnd.cd.after}`
    );
}
