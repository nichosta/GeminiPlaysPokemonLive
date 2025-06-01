import * as CONSTANTS from '../constant/constants.js';
import { readUint8, readUint16, readUint32, readRange } from '../emulatorInteraction/httpMemoryReader.js';

/**
 * Finds the TaskFunc pointer of the first active task in the task array.
 * This is equivalent to the C function `FindFirstActiveTask`.
 *
 * @returns {Promise<number>} The task function pointer if found, or 0 if no active task with HEAD_SENTINEL prev is found.
 */
export async function findFirstActiveTask() {
    try {
        // We can optimize by reading the whole task array block once
        const totalTaskArraySize = CONSTANTS.TASK_COUNT * CONSTANTS.TASK_SIZE;
        const taskDataBytes = new Uint8Array(await readRange(CONSTANTS.TASK_ARRAY_ADDR, totalTaskArraySize));
        const dataView = new DataView(taskDataBytes.buffer, taskDataBytes.byteOffset, taskDataBytes.byteLength);

        for (let taskId = 0; taskId < CONSTANTS.TASK_COUNT; taskId++) {
            const currentOffset = taskId * CONSTANTS.TASK_SIZE;

            // Check if the task is active.
            const isActiveByteOffset = currentOffset + CONSTANTS.TASK_IS_ACTIVE_OFFSET;
            const isActive = dataView.getUint8(isActiveByteOffset); // In C, this is just u8
            // Check if the prev field is HEAD_SENTINEL (0xFE). The `prev` field is after `isActive`.
            const prevByteOffset = currentOffset + CONSTANTS.TASK_PREV_OFFSET;
            const prev = dataView.getUint8(prevByteOffset);

            // In C, isActive is a u8 treated as boolean (TRUE/FALSE).
            // In JS, a non-zero u8 value is truthy. The C code checks `isActive == TRUE`.
            // We can simplify this check as `isActive !== 0`.
            // The C code checks `gTasks[taskId].prev == HEAD_SENTINEL`. In C, HEAD_SENTINEL is 0xFE.
            // We need to check if the byte read for `prev` is 0xFE.
            if (isActive !== 0 && prev === CONSTANTS.TASK_HEAD_SENTINEL) {
                let funcPtrOffset = currentOffset + CONSTANTS.TASK_FUNC_PTR_OFFSET;
                let funcPtr = dataView.getUint32(funcPtrOffset, true); // Read little endian

                return funcPtr; // Found the first active task with HEAD_SENTINEL prev
            }
        }

        // If the loop completes without finding a matching task
        return 0;

    } catch (error) {
        console.error("Error finding first active task:", error);
        return 0; // Return 0 indicating not found on error
    }
}

// Run taskStatus as a test
// async function testFindFirstActiveTask() {
//     console.log("Testing findFirstActiveTask...");
//     const taskPtr = await findFirstActiveTask();
//     console.log(`Result: ${taskPtr.toString(16)}`);
// }

// testFindFirstActiveTask();
