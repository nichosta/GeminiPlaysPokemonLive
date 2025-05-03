import * as GAMESTATE_CONSTANTS from "./constants.js";
import { readUint32 } from "./httpMemoryReader.js";

/**
 * Checks if the script pointer is set.
 * @param {object} memoryReader - The memory reader object.
 * @returns {Promise<boolean>} - A promise that resolves to true if the script pointer is set, false otherwise.
 */
export async function isScriptPtrSet() {
  const scriptContextPointer = await readUint32(GAMESTATE_CONSTANTS.SCRIPT_CONTEXT_ADDRESS + GAMESTATE_CONSTANTS.SCRIPT_CONTEXT_POINTER_OFFSET);
  return scriptContextPointer !== 0;
}