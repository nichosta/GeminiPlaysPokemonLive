import * as CONSTANTS from "../constant/constants.js";
import { readUint8, readUint16, readUint32 } from "../emulatorInteraction/httpMemoryReader.js";

/**
 * Gets the current map bank number.
 * @returns {Promise<number>} The map bank number.
 */
export async function getCurrentMapBank() {
    return await readUint8(CONSTANTS.MAP_BANK_ADDR);
}

/**
 * Gets the current map number within the bank.
 * @returns {Promise<number>} The map number.
 */
export async function getCurrentMapNumber() {
    return await readUint8(CONSTANTS.MAP_NUMBER_ADDR);
}

/**
 * Gets the direction the player is facing.
 * @returns {Promise<string>} The direction the player is facing (lowercase).
 */
export async function getPlayerFacingDirection() {
    const direction = await readUint8(CONSTANTS.FACING_DIRECTION_ADDR);
    const maskedDirection = direction & CONSTANTS.FACING_DIRECTION_MASK;
    return CONSTANTS.FACING_DIRECTION_MAP.get(maskedDirection) ?? "unknown";
}

/**
 * Gets the base address of the player/camera object structure in EWRAM.
 * Reads the pointer stored at SAVESTATE_OBJECT_POINTER_ADDR.
 * @returns {Promise<number>} The base address (pointer value).
 */
async function getPlayerObjectBaseAddress() {
    return await readUint32(CONSTANTS.SAVESTATE_OBJECT_POINTER_ADDR);
}

/**
 * Gets the player's current X coordinate (in tile units).
 * Reads the pointer at SAVESTATE_OBJECT_POINTER_ADDR and adds the offset.
 * @returns {Promise<number>} The player's X coordinate.
 */
export async function getPlayerX() {
    const baseAddress = await getPlayerObjectBaseAddress();
    // Consider removing or clarifying this comment if "[6]" isn't clear
    return await readUint16(baseAddress + CONSTANTS.PLAYER_X_OFFSET); // [6]
}

/**
 * Gets the player's current Y coordinate (in tile units).
 * Reads the pointer at SAVESTATE_OBJECT_POINTER_ADDR and adds the offset.
 * @returns {Promise<number>} The player's Y coordinate.
 */
export async function getPlayerY() {
    const baseAddress = await getPlayerObjectBaseAddress();
    // Consider removing or clarifying this comment if "[6]" isn't clear
    return await readUint16(baseAddress + CONSTANTS.PLAYER_Y_OFFSET); // [6]
}

/**
 * Gets the player's current position as an object with x and y properties.
 * @returns {Promise<{x: number, y: number}>} The player's position.
 */
export async function getPlayerPosition() {
    const baseAddress = await getPlayerObjectBaseAddress();
    const x = await readUint16(baseAddress + CONSTANTS.PLAYER_X_OFFSET);
    const y = await readUint16(baseAddress + CONSTANTS.PLAYER_Y_OFFSET);
    return [ x, y ];
}

/**
 * Checks if the player is currently surfing.
 * @returns {Promise<boolean>} True if the player is surfing, false otherwise.
 */
export async function isPlayerSurfing() {
    const playerAvatarFlags = await readUint8(CONSTANTS.PLAYER_AVATAR_ADDR + CONSTANTS.PLAYER_AVATAR_FLAGS_OFFSET);
    return (playerAvatarFlags & CONSTANTS.PLAYER_AVATAR_FLAG_SURFING) !== 0;
}

// Check if player field controls are locked
/**
 * Checks if the player's field controls are currently locked.
 * @returns {Promise<boolean>} True if controls are locked, false otherwise.
 */
export async function areFieldControlsLocked() {
    // If the value at the address is non-zero, controls are locked.
    const lockValue = await readUint8(CONSTANTS.SCRIPT_LOCK_FIELD_CONTROLS);
    return lockValue !== 0;
}