import * as CONSTANTS from "./constant/constants.js";
import { readUint8, readUint32 } from "./emulatorInteraction/httpMemoryReader.js";

/**
 * Checks if the script pointer is set.
 * @param {object} memoryReader - The memory reader object.
 * @returns {Promise<boolean>} - A promise that resolves to true if the script pointer is set, false otherwise.
 */
export async function isScriptPtrSet() {
  const scriptContextPointer = await readUint32(CONSTANTS.SCRIPT_CONTEXT_ADDRESS + CONSTANTS.SCRIPT_CONTEXT_POINTER_OFFSET);
  return scriptContextPointer !== 0;
}

/**
 * Checks if the field message box is active.
 * @returns {Promise<boolean>} - A promise that resolves to true if the field message box is active, false otherwise.
 */
export async function isFieldMessageBoxActive() {
    const messageBoxMode = await readUint8(CONSTANTS.FIELD_MESSAGE_BOX_ADDR);
    return messageBoxMode > 0;
}
