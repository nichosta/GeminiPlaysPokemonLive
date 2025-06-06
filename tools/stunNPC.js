import { readUint32 } from "../gamestate/emulatorInteraction/httpMemoryReader.js";
import { writeUint32 } from "../gamestate/emulatorInteraction/httpMemoryWriter.js";
import * as CONSTANTS from "../gamestate/constant/constants.js";

/**
 * Sets the "frozen" flag for a specific NPC (Object Event).
 * This prevents the NPC from moving or animating.
 * @param {number} npcId The ID (index) of the NPC in the gObjectEvents array (0-15).
 *                       Note: ID 0 is banned due to being the player.
 * @returns {Promise<boolean>} True if the operation was successful, false otherwise.
 */
export async function stunNPC(npcId) {
    if (npcId < 1 || npcId >= CONSTANTS.OBJECT_EVENT_COUNT) {
        console.error(`Invalid npcId: ${npcId}. Must be between 1 and ${CONSTANTS.OBJECT_EVENT_COUNT - 1}.`);
        return false;
    }

    try {
        const npcBaseAddr = CONSTANTS.OBJECT_EVENTS_ADDR + (npcId * CONSTANTS.OBJECT_EVENT_SIZE);
        const flagsAddr = npcBaseAddr + CONSTANTS.OBJECT_EVENT_FLAGS_OFFSET;

        const currentFlags = await readUint32(flagsAddr);
        const newFlags = currentFlags ^ (1 << CONSTANTS.OBJECT_EVENT_FROZEN_BIT); // Set the frozen bit

        await writeUint32(flagsAddr, newFlags);
        // console.log(`NPC ${npcId} flags updated to ${newFlags.toString(16)} (frozen bit set).`);
        return true;
    } catch (error) {
        console.error(`Error stunning NPC ${npcId}:`, error);
        return false;
    }
}