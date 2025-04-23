// Base URL for the memory reading API
const API_BASE_URL = "http://localhost:5000/core";
const READ_RANGE_CHUNK_SIZE = 256; // Define the chunk size

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
    const data = await response.text();
    return Number.parseInt(data);
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
    const data = await response.text();
    return Number.parseInt(data);
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
    const data = await response.text();
    return Number.parseInt(data);
}

/**
 * Reads a range of bytes from memory in chunks, parsing a JSON array string response.
 * @param {number} address - The starting memory address (hexadecimal).
 * @param {number} length - The total number of bytes to read.
 * @returns {Promise<Array<number>>} An array of byte values (numbers 0-255) read from memory.
 */
export async function readRange(address, length) {
    const allBytes = [];
    let bytesRead = 0;

    while (bytesRead < length) {
        const currentAddress = address + bytesRead;
        const bytesToRead = Math.min(READ_RANGE_CHUNK_SIZE, length - bytesRead);
        // Assuming the endpoint still uses /readrange but now returns a JSON string
        const url = `${API_BASE_URL}/readRange?address=0x${currentAddress.toString(16)}&length=${bytesToRead}`;

        // console.debug(`[readRange] Fetching chunk: ${url}`);
        const response = await fetch(url);

        if (!response.ok) {
            let errorBody = `Status ${response.status}`;
            try {
                errorBody = await response.text();
            } catch (textError) { /* Ignore */ }
            // Throw error indicating which chunk failed
            throw new Error(`[readRange] HTTP error on chunk! Status: ${response.status}, Body: ${errorBody}, URL: ${url}`);
        }

        try {
            // Read the response as text
            const responseText = await response.text();
            // Parse the text as a JSON array
            const chunkBytes = JSON.parse(responseText);

            if (!Array.isArray(chunkBytes)) {
                throw new Error(`[readRange] Response for chunk URL ${url} was not a valid JSON array.`);
            }

            // console.debug(`[readRange] Received and parsed ${chunkBytes.length} bytes for chunk from ${url}.`);

            // Append the received bytes to the main array
            allBytes.push(...chunkBytes);

            // Update bytesRead based on the length of the parsed array
            bytesRead += chunkBytes.length;

            // Optional: Check if the server returned the expected number of bytes in the array
            if (chunkBytes.length !== bytesToRead && bytesRead < length) {
                 console.warn(`[readRange] Received ${chunkBytes.length} bytes in array, expected ${bytesToRead} for chunk at ${currentAddress.toString(16)}. Total read: ${bytesRead}/${length}`);
                 // Decide if you want to stop or continue based on this warning
            }

        } catch (error) {
            // Catch JSON parsing errors or other issues
            console.error(`[readRange] Error processing JSON response for chunk URL ${url}:`, error);
            throw error; // Re-throw error after logging
        }
    }

    // console.debug(`[readRange] Total bytes received: ${allBytes.length}.`);
    // No need for the fixCorruptedFFBytes workaround anymore
    return allBytes;
}