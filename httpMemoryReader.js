// Base URL for the memory reading API
const API_BASE_URL = "http://localhost:5000/core";

// --- Helper Functions for Memory Reading ---

/**
 * Reads an 8-bit unsigned integer (u8) from a given memory address.
 * @param {number} address - The memory address (hexadecimal).
 * @returns {Promise<number>} The value read from memory.
 */
export async function readUint8(address) {
    const response = await fetch(`${API_BASE_URL}/read8?address=0x${address.toString(16)}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
}

/**
 * Reads a 16-bit unsigned integer (u16) from a given memory address (little-endian).
 * @param {number} address - The memory address (hexadecimal).
 * @returns {Promise<number>} The value read from memory.
 */
export async function readUint16(address) {
    const response = await fetch(`${API_BASE_URL}/read16?address=0x${address.toString(16)}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
}

/**
 * Reads a 32-bit unsigned integer (u32) from a given memory address (little-endian).
 * @param {number} address - The memory address (hexadecimal).
 * @returns {Promise<number>} The value read from memory.
 */
export async function readUint32(address) {
    const response = await fetch(`${API_BASE_URL}/read32?address=0x${address.toString(16)}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
}

/**
 * Replaces occurrences of the UTF-8 replacement character sequence (EF BF BD)
 * with the intended 0xFF byte in a Uint8Array.
 * NOTE: This is a workaround for a server-side issue where 0xFF bytes are corrupted.
 * @param {Uint8Array} rawBytes - The potentially corrupted byte array from the server.
 * @returns {Array} A new Array with the replacements made.
 */
function fixCorruptedFFBytes(rawBytes) {
    const correctedBytes = [];
    let i = 0;
    while (i < rawBytes.length) {
        // Check for the specific 3-byte sequence EF BF BD (239, 191, 189)
        if (i + 2 < rawBytes.length &&
            rawBytes[i] === 239 &&    // 0xEF
            rawBytes[i + 1] === 191 && // 0xBF
            rawBytes[i + 2] === 189) { // 0xBD

            // Replace the sequence with the intended 0xFF byte
            correctedBytes.push(255); // 0xFF
            i += 3; // Skip the next two bytes as they were part of the sequence
        } else {
            // Keep the current byte as is
            correctedBytes.push(rawBytes[i]);
            i += 1;
        }
    }
    return correctedBytes;
}


/**
 * Reads a range of bytes from memory and applies a workaround for server-side 0xFF corruption.
 * @param {number} address - The starting memory address (hexadecimal).
 * @param {number} length - The number of bytes to read.
 * @returns {Promise<Array>} The raw bytes read from memory as an Array, with corrupted 0xFF bytes corrected.
 */
export async function readRange(address, length) {
    const url = `${API_BASE_URL}/readrange?address=0x${address.toString(16)}&length=${length}`;
    // console.debug(`[readRange] Fetching: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
        let errorBody = `Status ${response.status}`;
        try {
            errorBody = await response.text();
        } catch (textError) { /* Ignore */ }
        throw new Error(`[readRange] HTTP error! Status: ${response.status}, Body: ${errorBody}, URL: ${url}`);
    }

    try {
        const arrayBuffer = await response.arrayBuffer();
        const rawBytes = new Uint8Array(arrayBuffer);
        // console.debug(`[readRange] Received ${rawBytes.length} bytes from ${url}. Applying workaround...`);

        // *** Apply the workaround here ***
        const correctedBytes = fixCorruptedFFBytes(rawBytes);

        if (rawBytes.length !== correctedBytes.length) {
            //  console.warn(`[readRange] Workaround changed byte array length from ${rawBytes.length} to ${correctedBytes.length} for URL: ${url}`);
        }
        // console.debug(`[readRange] Returning ${correctedBytes.length} corrected bytes.`);
        return correctedBytes;

    } catch (error) {
        console.error(`[readRange] Error processing ArrayBuffer for URL ${url}:`, error);
        throw error;
    }
}