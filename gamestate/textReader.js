import { readUint32 } from "./httpMemoryReader.js";

const SCRIPT_CONTEXT_ADDRESS = 0x03000EB0; // Pointer to the sGlobalScriptContext object with script state
const SCRIPT_CONTEXT_POINTER_OFFSET = 0x08; // Offset from start of sGlobalScriptContext to pointer to scriptPtr


// There's probably horrific issues this is going to cause down the line, but I noticed this pointer only seems to be set
// when there's an overworld text box open, so...

/**
 * Checks if the script pointer is set.
 * @param {object} memoryReader - The memory reader object.
 * @returns {Promise<boolean>} - A promise that resolves to true if the script pointer is set, false otherwise.
 */
export async function isScriptPtrSet() {
  const scriptContextPointer = await readUint32(SCRIPT_CONTEXT_ADDRESS + SCRIPT_CONTEXT_POINTER_OFFSET);
  return scriptContextPointer !== 0;
}