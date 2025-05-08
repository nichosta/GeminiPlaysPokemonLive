// Base URL for the memory writing API
const API_BASE_URL = "http://localhost:5000/core";

// --- Helper Functions for Memory Writing ---

/**
 * Writes an 8-bit unsigned integer (u8) to a given memory address.
 * @param {number} address - The memory address (hexadecimal).
 * @param {number} value - The value to write (decimal).
 * @returns {Promise<void>}
 * @throws {Error} If the HTTP request fails.
 */
export async function writeUint8(address, value) {
    const url = `${API_BASE_URL}/write8?address=0x${address.toString(16)}&value=${value}`;
    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) {
        throw new Error(`HTTP error writing u8! Status: ${response.status} URL: ${url}`);
    }
    // No return value needed for write operations, just check for success.
}

/**
 * Writes a 16-bit unsigned integer (u16) to a given memory address (little-endian).
 * @param {number} address - The memory address (hexadecimal).
 * @param {number} value - The value to write (decimal).
 * @returns {Promise<void>}
 * @throws {Error} If the HTTP request fails.
 */
export async function writeUint16(address, value) {
    const url = `${API_BASE_URL}/write16?address=0x${address.toString(16)}&value=${value}`;
    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) {
        throw new Error(`HTTP error writing u16! Status: ${response.status} URL: ${url}`);
    }
}

/**
 * Writes a 32-bit unsigned integer (u32) to a given memory address (little-endian).
 * @param {number} address - The memory address (hexadecimal).
 * @param {number} value - The value to write (decimal).
 * @returns {Promise<void>}
 * @throws {Error} If the HTTP request fails.
 */
export async function writeUint32(address, value) {
    const url = `${API_BASE_URL}/write32?address=0x${address.toString(16)}&value=${value}`;
    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) {
        throw new Error(`HTTP error writing u32! Status: ${response.status} URL: ${url}`);
    }
}