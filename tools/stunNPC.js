import { readUint32 } from "../gamestate/emulatorInteraction/httpMemoryReader.js";
import { writeUint32 } from "../gamestate/emulatorInteraction/httpMemoryWriter.js";
import * as CONSTANTS from "../gamestate/constant/constants.js";

/**
 * Sets the "frozen" flag for a specific NPC (Object Event).
 * This prevents the NPC from moving or animating.
 * Calling on a frozen NPC unfreezes them.
 * Freezing an NPC moving between tiles and then talking to them locks the game;
 * I believe this is because the game freezes everything else and waits for them to reach the other tile before opening the textbox,
 * but they never finish moving. If this happens, you will need to unfreeze them.
 * You can check if the NPC is actively moving between tiles, that would be my suggested method to fix this.
 * @param {number} npcId The ID (index) of the NPC in the gObjectEvents array (0-15).
 * @returns {Promise<boolean>} True if the operation was successful, false otherwise.
 */
export async function stunNPC(npcId) {
    // ID 0 is banned due to being the player. >16 are out of the gObjectEvents array.
    // These are manually restricted in the tool call schema as well.
    if (npcId < 1 || npcId >= CONSTANTS.OBJECT_EVENT_COUNT) {
        console.error(`Invalid npcId: ${npcId}. Must be between 1 and ${CONSTANTS.OBJECT_EVENT_COUNT - 1}.`);
        return false;
    }

    try {
        const npcBaseAddr = CONSTANTS.OBJECT_EVENTS_ADDR + (npcId * CONSTANTS.OBJECT_EVENT_SIZE);
        const flagsAddr = npcBaseAddr + CONSTANTS.OBJECT_EVENT_FLAGS_OFFSET;

        const currentFlags = await readUint32(flagsAddr);
        const newFlags = currentFlags ^ (1 << CONSTANTS.OBJECT_EVENT_FROZEN_BIT); // XOR the frozen bit

        await writeUint32(flagsAddr, newFlags);
        return true;
    } catch (error) {
        console.error(`Error stunning NPC ${npcId}:`, error);
        return false;
    }
}