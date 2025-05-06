import { readUint32 } from "../gamestate/httpMemoryReader.js";
import { writeUint32 } from "../gamestate/httpMemoryWriter.js";
import * as MAP_CONSTANTS from "../gamestate/overworld/constants.js";

/**
 * Sets the "frozen" flag for a specific NPC (Object Event).
 * This prevents the NPC from moving or animating.
 * @param {number} npcId The ID (index) of the NPC in the gObjectEvents array (0-15).
 *                       Note: ID 0 is banned due to being the player.
 * @returns {Promise<boolean>} True if the operation was successful, false otherwise.
 */
export async function stunNPC(npcId) {
    if (npcId < 1 || npcId >= MAP_CONSTANTS.OBJECT_EVENT_COUNT) {
        console.error(`Invalid npcId: ${npcId}. Must be between 1 and ${MAP_CONSTANTS.OBJECT_EVENT_COUNT - 1}.`);
        return false;
    }

    try {
        const npcBaseAddr = MAP_CONSTANTS.OBJECT_EVENTS_ADDR + (npcId * MAP_CONSTANTS.OBJECT_EVENT_SIZE);
        const flagsAddr = npcBaseAddr + MAP_CONSTANTS.OBJECT_EVENT_FLAGS_OFFSET;

        const currentFlags = await readUint32(flagsAddr);
        const newFlags = currentFlags | (1 << MAP_CONSTANTS.OBJECT_EVENT_FROZEN_BIT); // Set the frozen bit

        await writeUint32(flagsAddr, newFlags);
        // console.log(`NPC ${npcId} flags updated to ${newFlags.toString(16)} (frozen bit set).`);
        return true;
    } catch (error) {
        console.error(`Error stunning NPC ${npcId}:`, error);
        return false;
    }
}