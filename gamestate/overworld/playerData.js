import * as CONSTANTS from "../constant/constants.js";
import { getFlagAddress, BADGE_DEFINITIONS } from "../../constant/savestate_flag_map.js";
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
 * Gets the base address of the savestate/camera object structure in EWRAM.
 * Reads the pointer stored at SAVESTATE_OBJECT_POINTER_ADDR.
 * @returns {Promise<number>} The base address (pointer value).
 */
async function getSavestateObjectBaseAddress() {
    return await readUint32(CONSTANTS.SAVESTATE_OBJECT_POINTER_ADDR);
}

/**
 * Gets the player's current X coordinate (in tile units).
 * Reads the pointer at SAVESTATE_OBJECT_POINTER_ADDR and adds the offset.
 * @returns {Promise<number>} The player's X coordinate.
 */
export async function getPlayerX() {
    const baseAddress = await getSavestateObjectBaseAddress();
    // Consider removing or clarifying this comment if "[6]" isn't clear
    return await readUint16(baseAddress + CONSTANTS.SAVESTATE_PLAYER_X_OFFSET); // [6]
}

/**
 * Gets the player's current Y coordinate (in tile units).
 * Reads the pointer at SAVESTATE_OBJECT_POINTER_ADDR and adds the offset.
 * @returns {Promise<number>} The player's Y coordinate.
 */
export async function getPlayerY() {
    const baseAddress = await getSavestateObjectBaseAddress();
    // Consider removing or clarifying this comment if "[6]" isn't clear
    return await readUint16(baseAddress + CONSTANTS.SAVESTATE_PLAYER_Y_OFFSET); // [6]
}

/**
 * Gets the player's current position as an object with x and y properties.
 * @returns {Promise<{x: number, y: number}>} The player's position.
 */
export async function getPlayerPosition() {
    const baseAddress = await getSavestateObjectBaseAddress();
    const x = await readUint16(baseAddress + CONSTANTS.SAVESTATE_PLAYER_X_OFFSET);
    const y = await readUint16(baseAddress + CONSTANTS.SAVESTATE_PLAYER_Y_OFFSET);
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

/**
 * Checks if the player's field controls are currently locked.
 * @returns {Promise<boolean>} True if controls are locked, false otherwise.
 */
export async function areFieldControlsLocked() {
    // If the value at the address is non-zero, controls are locked.
    const lockValue = await readUint8(CONSTANTS.SCRIPT_LOCK_FIELD_CONTROLS);
    return lockValue !== 0;
}

/**
 * Reads a specific flag from the player's savestate flags.
 * This function is intended for system/script flags where 'bitOffset' is the global flag ID.
 * @param {number} bitOffset The bit offset of the flag to read.
 * @returns {Promise<boolean>} True if the flag is set (1), false otherwise.
 */
export async function readPlayerFlag(bitOffset) {
    const flagsBaseAddress = await getSavestateObjectBaseAddress() + CONSTANTS.SAVESTATE_FLAGS_OFFSET;
    const byteOffset = Math.floor(bitOffset / 8);
    const bitInByte = bitOffset % 8;
    const byteValue = await readUint8(flagsBaseAddress + byteOffset);
    return (byteValue & (1 << bitInByte)) !== 0;
}

/**
 * Gets a list of badges the player has earned.
 * @returns {Promise<string[]>} An array of strings, where each string is the name of an earned badge.
 */
export async function getPlayerBadges() {
    const earnedBadges = [];
    for (const badge of BADGE_DEFINITIONS) {
        const flagId = getFlagAddress(badge.flagConstant);
        if (flagId === undefined) {
            console.warn(`Badge flag constant "${badge.flagConstant}" (for badge "${badge.name}") not found in flag map. Skipping.`);
            continue;
        }
        if (await readPlayerFlag(flagId)) {
            earnedBadges.push(badge.name);
        }
    }
    return earnedBadges;
}