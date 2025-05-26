import { readUint8, readUint16, readUint32, readRange } from "./emulatorInteraction/httpMemoryReader.js";
import { getSpeciesName } from '../constant/species_map.js';
import { getMoveName } from '../constant/moves_map.js';
import { decodeByteArrayToString } from '../constant/text_character_map.js'
import { getAbilityName } from '../constant/ability_map.js';
import * as CONSTANTS from "./constant/constants.js";

const POKEMON_TYPE_MAP = new Map([
  [255, "NONE"],
  [0, "NORMAL"],
  [1, "FIGHTING"],
  [2, "FLYING"],
  [3, "POISON"],
  [4, "GROUND"],
  [5, "ROCK"],
  [6, "BUG"],
  [7, "GHOST"],
  [8, "STEEL"],
  [9, "MYSTERY"], // ???
  [10, "FIRE"],
  [11, "WATER"],
  [12, "GRASS"],
  [13, "ELECTRIC"],
  [14, "PSYCHIC"],
  [15, "ICE"],
  [16, "DRAGON"],
  [17, "DARK"],
]);

// Lookup table for substructure order based on PID % 24 [2]
const SUBSTRUCTURE_ORDER = [
    "GAEM", "GAME", "GEAM", "GEMA", "GMAE", "GMEA", // 0-5
    "AGEM", "AGME", "AEGM", "AEMG", "AMGE", "AMEG", // 6-11
    "EGAM", "EGMA", "EAGM", "EAMG", "EMGA", "EMAG", // 12-17
    "MGAE", "MGEA", "MAGE", "MAEG", "MEGA", "MEAG"  // 18-23
];

/**
 * Checks if the player is currently in a battle.
 * @returns {Promise<boolean>} True if in battle, false otherwise.
 */
export async function isInBattle() {
    const bitmask = await readUint8(CONSTANTS.IN_BATTLE_BIT_ADDR);
    // Check if the bit corresponding to in-battle is set
    return (bitmask & CONSTANTS.IN_BATTLE_BITMASK) !== 0;
}

/**
 * Calculates the base address for a specific Pokémon in the party.
 * @param {number} slot - The party slot index (0-5).
 * @returns {number} The base memory address for that Pokémon's data.
 */
function getPartyPokemonBaseAddress(slot) {
    if (slot < 0 || slot > 5) {
        throw new Error("Invalid party slot index. Must be between 0 and 5.");
    }
    return CONSTANTS.PARTY_BASE_ADDR + (slot * CONSTANTS.POKEMON_DATA_SIZE);
}

/**
 * Gets the nickname of a Pokémon in the specified party slot.
 * NOTE: Requires a function to decode the game's character encoding.
 * This function returns the raw bytes as a Uint8Array.
 * @param {number} slot - The party slot index (0-5).
 * @returns {Promise<Uint8Array>} Raw bytes of the nickname (10 bytes).
 */
async function getPokemonNickname(slot) {
    const baseAddr = getPartyPokemonBaseAddress(slot);
    const nicknameAddr = baseAddr + CONSTANTS.NICKNAME_OFFSET;
    const buffer = await readRange(nicknameAddr, 10);
    return decodeByteArrayToString(buffer);
    // The string is terminated by 0xFF, remaining bytes padded with 0x00.[1]
}

/**
 * Gets the level of a Pokémon in the specified party slot.
 * @param {number} slot - The party slot index (0-5).
 * @returns {Promise<number>} The Pokémon's level.
 */
async function getPokemonLevel(slot) {
    const baseAddr = getPartyPokemonBaseAddress(slot);
    return await readUint8(baseAddr + CONSTANTS.LEVEL_OFFSET);
}

/**
 * Gets the current HP of a Pokémon in the specified party slot.
 * @param {number} slot - The party slot index (0-5).
 * @returns {Promise<number>} The Pokémon's current HP.
 */
async function getPokemonCurrentHP(slot) {
    const baseAddr = getPartyPokemonBaseAddress(slot);
    return await readUint16(baseAddr + CONSTANTS.CURRENT_HP_OFFSET);
}

/**
 * Gets the maximum HP of a Pokémon in the specified party slot.
 * @param {number} slot - The party slot index (0-5).
 * @returns {Promise<number>} The Pokémon's maximum HP.
 */
async function getPokemonMaxHP(slot) {
    const baseAddr = getPartyPokemonBaseAddress(slot);
    return await readUint16(baseAddr + CONSTANTS.MAX_HP_OFFSET);
}

/**
 * Gets the Attack stat of a Pokémon in the specified party slot.
 * @param {number} slot - The party slot index (0-5).
 * @returns {Promise<number>} The Pokémon's Attack stat.
 */
async function getPokemonAttack(slot) {
    const baseAddr = getPartyPokemonBaseAddress(slot);
    return await readUint16(baseAddr + CONSTANTS.ATTACK_OFFSET);
}

/**
 * Gets the Defense stat of a Pokémon in the specified party slot.
 * @param {number} slot - The party slot index (0-5).
 * @returns {Promise<number>} The Pokémon's Defense stat.
 */
async function getPokemonDefense(slot) {
    const baseAddr = getPartyPokemonBaseAddress(slot);
    return await readUint16(baseAddr + CONSTANTS.DEFENSE_OFFSET);
}

/**
 * Gets the Speed stat of a Pokémon in the specified party slot.
 * @param {number} slot - The party slot index (0-5).
 * @returns {Promise<number>} The Pokémon's Speed stat.
 */
async function getPokemonSpeed(slot) {
    const baseAddr = getPartyPokemonBaseAddress(slot);
    return await readUint16(baseAddr + CONSTANTS.SPEED_OFFSET);
}

/**
 * Gets the Special Attack stat of a Pokémon in the specified party slot.
 * @param {number} slot - The party slot index (0-5).
 * @returns {Promise<number>} The Pokémon's Special Attack stat.
 */
async function getPokemonSpAttack(slot) {
    const baseAddr = getPartyPokemonBaseAddress(slot);
    return await readUint16(baseAddr + CONSTANTS.SP_ATTACK_OFFSET);
}

/**
 * Gets the Special Defense stat of a Pokémon in the specified party slot.
 * @param {number} slot - The party slot index (0-5).
 * @returns {Promise<number>} The Pokémon's Special Defense stat.
 */
async function getPokemonSpDefense(slot) {
    const baseAddr = getPartyPokemonBaseAddress(slot);
    return await readUint16(baseAddr + CONSTANTS.SP_DEFENSE_OFFSET);
}

/**
 * Gets the status condition bitmask of a Pokémon in the specified party slot.
 * Bits 0-2: Sleep turns | Bit 3: Poison | Bit 4: Burn | Bit 5: Freeze | Bit 6: Paralysis | Bit 7: Bad Poison (Toxic) [1]
 * @param {number} slot - The party slot index (0-5).
 * @returns {Promise<number>} The status condition bitmask (u32).
 */
async function getPokemonStatusCondition(slot) {
    const baseAddr = getPartyPokemonBaseAddress(slot);
    return await readUint32(baseAddr + CONSTANTS.STATUS_OFFSET);
}

// --- Decryption and Unshuffling Logic ---

/**
 * Reads the Personality Value (PID) for a Pokémon.
 * @param {number} slot - Party slot index (0-5).
 * @returns {Promise<number>} The 32-bit PID.
 */
async function getPokemonPID(slot) {
    const baseAddr = getPartyPokemonBaseAddress(slot);
    return await readUint32(baseAddr + CONSTANTS.PID_OFFSET);
}

/**
 * Reads the Original Trainer ID (OTID) for a Pokémon.
 * @param {number} slot - Party slot index (0-5).
 * @returns {Promise<number>} The 32-bit OTID.
 */
async function getPokemonOTID(slot) {
    const baseAddr = getPartyPokemonBaseAddress(slot);
    return await readUint32(baseAddr + CONSTANTS.OTID_OFFSET);
}

/**
 * Reads the raw 48-byte encrypted data block for a Pokémon.
 * @param {number} slot - Party slot index (0-5).
 * @returns {Promise<ArrayBuffer>} The 48 encrypted bytes.
 */
async function getEncryptedBlock(slot) {
    const baseAddr = getPartyPokemonBaseAddress(slot);
    return Uint8Array.from(await readRange(baseAddr + CONSTANTS.ENCRYPTED_BLOCK_OFFSET, CONSTANTS.ENCRYPTED_BLOCK_SIZE)).buffer;
}

/**
 * Decrypts the 48-byte data block using the PID and OTID.
 * @param {ArrayBuffer} encryptedBuffer - The 48 encrypted bytes.
 * @param {number} pid - The Pokémon's 32-bit Personality Value.
 * @param {number} otid - The Pokémon's 32-bit Original Trainer ID.
 * @returns {ArrayBuffer} The 48 decrypted bytes.
 */
function decryptBlock(encryptedBuffer, pid, otid) {
    const decryptionKey = pid ^ otid; // [1, 2]
    const encryptedView = new DataView(encryptedBuffer);
    const decryptedBuffer = new ArrayBuffer(CONSTANTS.ENCRYPTED_BLOCK_SIZE);
    const decryptedView = new DataView(decryptedBuffer);

    for (let i = 0; i < CONSTANTS.ENCRYPTED_BLOCK_SIZE; i += 4) {
        // Read 32 bits (4 bytes) in little-endian format
        const encryptedChunk = encryptedView.getUint32(i, true);
        // XOR with the key [2]
        const decryptedChunk = encryptedChunk ^ decryptionKey;
        // Write back in little-endian format
        decryptedView.setUint32(i, decryptedChunk, true);
    }

    return decryptedBuffer;
}

/**
 * Unshuffles the decrypted 12-byte substructures based on PID.
 * @param {ArrayBuffer} decryptedBuffer - The 48 decrypted bytes.
 * @param {number} pid - The Pokémon's 32-bit Personality Value.
 * @returns {{G: ArrayBuffer | null, A: ArrayBuffer | null, E: ArrayBuffer | null, M: ArrayBuffer | null}} Object containing the four substructures.
 */
function unshuffleSubstructures(decryptedBuffer, pid) {
    // --- Re-include your corrected unshuffleSubstructures implementation here ---
     if (!decryptedBuffer || decryptedBuffer.byteLength !== CONSTANTS.ENCRYPTED_BLOCK_SIZE) {
        console.error("Invalid decrypted buffer provided to unshuffleSubstructures.");
        return { G: null, A: null, E: null, M: null };
    }
    const orderIndex = pid % 24;
    const orderString = SUBSTRUCTURE_ORDER[orderIndex];
    const unshuffled = { G: null, A: null, E: null, M: null };

    for (let i = 0; i < orderString.length; i++) {
        const substructureType = orderString[i];
        const sourceOffset = i * CONSTANTS.SUBSTRUCTURE_SIZE;
        if (sourceOffset + CONSTANTS.SUBSTRUCTURE_SIZE <= decryptedBuffer.byteLength) {
            const substructureSlice = decryptedBuffer.slice(sourceOffset, sourceOffset + CONSTANTS.SUBSTRUCTURE_SIZE);
            unshuffled[substructureType] = substructureSlice;
        } else {
             console.error(`Substructure slicing out of bounds for type ${substructureType} at offset ${sourceOffset}`);
        }
    }
    return unshuffled;
    // --- End of unshuffleSubstructures implementation ---
}

/**
 * Gets Species ID from the Growth substructure ArrayBuffer.
 * @param {ArrayBuffer} growthBuffer - The 12-byte Growth substructure.
 * @returns {number} The species ID.
 * @throws {Error} If the buffer is invalid.
 */
function getSpeciesId(growthBuffer) {
    if (!growthBuffer || growthBuffer.byteLength < 2) { // Need at least 2 bytes for u16
        throw new Error("Invalid Growth buffer provided to getSpeciesId.");
    }
    const view = new DataView(growthBuffer);
    return view.getUint16(0, true); // Offset 0, u16, little-endian [2]
}

/**
 * Calculates the number of Pokémon currently in the player's party.
 * It iterates through the party slots (0 to 5) and checks the species ID
 * of each Pokémon. The count stops when an empty slot (Species ID 0) is found
 * or when all 6 slots have been checked.
 *
 * @export
 * @returns {Promise<number>} The number of Pokémon in the party (0-6).
 */
export async function getPartyCount() {
    let count = 0;
    while (count < CONSTANTS.PARTY_SIZE) {
        try {
            const baseAddr = getPartyPokemonBaseAddress(count);

            // Optimization: Check PID first. If PID is 0, the slot is usually empty.
            const pid = await readUint32(baseAddr + CONSTANTS.PID_OFFSET);
            if (pid === 0) {
                // console.debug(`[getPartyCount] Slot ${count} has PID 0. Assuming empty.`);
                break; // Found an empty slot
            }

            // If PID is not 0, proceed to read data needed for species ID check
            const otid = await readUint32(baseAddr + CONSTANTS.OTID_OFFSET);
            const encryptedBlockBuffer = Uint8Array.from(await readRange(baseAddr + CONSTANTS.ENCRYPTED_BLOCK_OFFSET, CONSTANTS.ENCRYPTED_BLOCK_SIZE)).buffer;

            // Validate the read operation
            if (!encryptedBlockBuffer || encryptedBlockBuffer.byteLength !== CONSTANTS.ENCRYPTED_BLOCK_SIZE) {
                 console.warn(`[getPartyCount] Could not read valid encrypted block for slot ${count}. Stopping count.`);
                 break; // Stop counting if data is unreadable
            }

            // Decrypt and unshuffle to get the Growth substructure
            const decryptedBlock = decryptBlock(encryptedBlockBuffer, pid, otid);
            const substructures = unshuffleSubstructures(decryptedBlock, pid);

            // Check if Growth substructure exists
            if (!substructures.G) {
                console.warn(`[getPartyCount] Could not find Growth substructure for slot ${count} after unshuffling (PID: ${pid}). Stopping count.`);
                break; // Stop counting if data structure seems corrupt
            }

            // Get the species ID from the Growth substructure
            const speciesId = getSpeciesId(substructures.G);

            // console.debug(`[getPartyCount] Slot ${count}: PID=${pid}, SpeciesID=${speciesId}`);

            // Check if the species ID indicates an empty slot
            if (speciesId === CONSTANTS.SPECIES_NONE) {
                // console.debug(`[getPartyCount] Slot ${count} has SpeciesID ${SPECIES_NONE}. Found end of party.`);
                break; // Found an empty slot
            }

            // If species is valid (not SPECIES_NONE), increment count and check next slot
            count++;

        } catch (error) {
            // Log error and stop counting to prevent issues on persistent errors
            console.error(`[getPartyCount] Error checking party slot ${count}:`, error);
            break; // Stop counting if an error occurs reading/processing a slot
        }
    }
    // console.log(`[getPartyCount] Calculated party count: ${count}`);
    return count; // Return the final count
}

/**
 * Gets the species name of a Pokémon in the specified party slot.
 * @param {ArrayBuffer} growthBuffer - The 12-byte Growth substructure.
 * @returns {string} The Pokémon's species name.
 */
function getSpecies(growthBuffer) {
    const speciesId = getSpeciesId(growthBuffer);
    return getSpeciesName(speciesId);
}


/** Gets Held Item ID from Growth substructure. */
function getHeldItem(growthBuffer) { // Offset 2, u16 [2]
    const view = new DataView(growthBuffer);
    return view.getUint16(2, true);
}

/** Gets Experience Points from Growth substructure. */
function getExperience(growthBuffer) { // Offset 4, u32 [2]
    const view = new DataView(growthBuffer);
    return view.getUint32(4, true);
}

/** Gets PP Bonuses bitfield from Growth substructure. */
function getPPBonuses(growthBuffer) { // Offset 8, u8 [2]
    const view = new DataView(growthBuffer);
    return view.getUint8(8);
    // Each move gets 2 bits (0-3 PP Ups)
    // Move 1: bits 0-1
    // Move 2: bits 2-3
    // Move 3: bits 4-5
    // Move 4: bits 6-7
}

/** Gets Friendship value from Growth substructure. */
function getFriendship(growthBuffer) { // Offset 9, u8 [2]
    const view = new DataView(growthBuffer);
    return view.getUint8(9);
}

/** Gets Move ID from Attacks substructure. */
function getMove(attacksBuffer, moveIndex) { // Offsets 0, 2, 4, 6 (u16) [2]
    if (moveIndex < 0 || moveIndex > 3) throw new Error("Invalid move index");
    const view = new DataView(attacksBuffer);
    return view.getUint16(moveIndex * 2, true);
}

/** Gets Current PP for a move from Attacks substructure. */
function getCurrentPP(attacksBuffer, moveIndex) { // Offsets 8, 9, 10, 11 (u8) [2]
    if (moveIndex < 0 || moveIndex > 3) throw new Error("Invalid move index");
    const view = new DataView(attacksBuffer);
    return view.getUint8(8 + moveIndex);
}

/** Gets an EV value from EVs & Condition substructure. */
function getEV(evsBuffer, statIndex) { // Offsets 0-5 (u8) [2]
    // 0: HP, 1: Atk, 2: Def, 3: Spe, 4: SpA, 5: SpD
    if (statIndex < 0 || statIndex > 5) throw new Error("Invalid EV stat index");
    const view = new DataView(evsBuffer);
    return view.getUint8(statIndex);
}

/** Gets the raw IVs/Egg/Ability bitfield from Miscellaneous substructure. */
function getIVsEggAbilityBitfield(miscBuffer) { // Offset 4, u32 [2]
    const view = new DataView(miscBuffer);
    return view.getUint32(4, true);
}

/** Extracts a specific IV from the IVs/Egg/Ability bitfield. */
function getIV(ivBitfield, statIndex) { // Bits 0-29 (5 bits each) [2]
    // 0: HP, 1: Atk, 2: Def, 3: Spe, 4: SpA, 5: SpD
    if (statIndex < 0 || statIndex > 5) throw new Error("Invalid IV stat index");
    const shift = statIndex * 5;
    return (ivBitfield >> shift) & 0x1F; // Mask for 5 bits (0b11111)
}

/** Checks the Is Egg flag from the IVs/Egg/Ability bitfield. */
function isEgg(ivBitfield) { // Bit 30 [2]
    return ((ivBitfield >> 30) & 1) === 1;
}

/** Gets the Ability slot flag from the IVs/Egg/Ability bitfield. */
function getAbilitySlot(ivBitfield) { // Bit 31 [2]
    // 0 = first ability, 1 = second ability
    return (ivBitfield >> 31) & 1;
}

/** Gets Met Location from Miscellaneous substructure. */
function getMetLocation(miscBuffer) { // Offset 1, u8 [2]
    const view = new DataView(miscBuffer);
    return view.getUint8(1);
}

/** Gets Pokerus status byte from Miscellaneous substructure. */
function getPokerusStatus(miscBuffer) { // Offset 0, u8 [2]
    const view = new DataView(miscBuffer);
    return view.getUint8(0);
    // Upper 4 bits: Strain (0=none, 1-15=infected)
    // Lower 4 bits: Days remaining (1-4)
}

/** Gets Origins info bitfield from Miscellaneous substructure. */
function getOriginsInfo(miscBuffer) { // Offset 2, u16 [2]
    const view = new DataView(miscBuffer);
    return view.getUint16(2, true);
    // Bits 0-6: Level met (0 for hatched)
    // Bits 7-10: Game of origin
    // Bits 11-14: Poké Ball caught in
    // Bit 15: OT Gender (0=M, 1=F)
}

/** Gets Ribbons/Obedience bitfield from Miscellaneous substructure. */
function getRibbonsObedience(miscBuffer) { // Offset 8, u32 [2]
    const view = new DataView(miscBuffer);
    return view.getUint32(8, true);
    // Lower bits are ribbons
    // Bit 31: Obedience flag
}

/**
 * Gets the types of a Pokémon based on its species ID.
 * @param {number} speciesId - The species ID of the Pokémon.
 * @returns {Promise<string[]>} An array of type names. Returns empty array for SPECIES_NONE or on error.
 */
async function getTypes(speciesId) {
    if (speciesId === CONSTANTS.SPECIES_NONE || !speciesId) {
        // console.debug(`[getTypes] SPECIES_NONE or invalid speciesId (${speciesId}), returning empty array.`);
        return [];
    }
    try {
        const speciesDataAddr = CONSTANTS.SPECIES_INFO_ADDR + (speciesId * CONSTANTS.SPECIES_INFO_SIZE);
        const typesOffsetAddr = speciesDataAddr + CONSTANTS.SPECIES_INFO_TYPES_OFFSET;

        const typesData = await readRange(typesOffsetAddr, 2); // u8 types[2]
        const type1Id = typesData[0];
        const type2Id = typesData[1];

        const type1Name = POKEMON_TYPE_MAP.get(type1Id) || `TYPE_UNKNOWN (${type1Id})`;
        const resultTypes = [type1Name];

        // Add second type if it's different from the first and not TYPE_NONE (255)
        if (type1Id !== type2Id && type2Id !== 255) {
            const type2Name = POKEMON_TYPE_MAP.get(type2Id) || `TYPE_UNKNOWN (${type2Id})`;
            resultTypes.push(type2Name);
        }
        return resultTypes;
    } catch (error) {
        console.error(`[getTypes] Error fetching types for species ID ${speciesId}:`, error);
        return [`TYPE_FETCH_ERROR`]; // Return an array with an error string
    }
}

/**
 * Gets the ability name of a Pokémon.
 * @param {number} abilitySlot - The ability slot (0 or 1).
 * @param {number} speciesId - The species ID of the Pokémon.
 * @returns {Promise<string|null>} The ability name, or null/error string on failure.
 */
async function getAbility(abilitySlot, speciesId) {
    if (speciesId === CONSTANTS.SPECIES_NONE || !speciesId) {
        return null;
    }
    try {
        const speciesDataAddr = CONSTANTS.SPECIES_INFO_ADDR + (speciesId * CONSTANTS.SPECIES_INFO_SIZE);
        const abilitiesOffsetAddr = speciesDataAddr + CONSTANTS.SPECIES_INFO_ABILITIES_OFFSET;
        const abilitiesData = await readRange(abilitiesOffsetAddr, 2); // u8 abilities[2]
        const abilityId = abilitiesData[abilitySlot === 1 ? 1 : 0]; // Ensure slot is 0 or 1
        return getAbilityName(abilityId);
    } catch (error) {
        console.error(`[getAbility] Error fetching ability for species ID ${speciesId}, slot ${abilitySlot}:`, error);
        return "ABILITY_FETCH_ERROR";
    }
}


// --- Main Function to Get Pokemon Data ---

/**
 * Fetches, decrypts, unshuffles, and parses the core data for a Pokémon.
 * @param {number} slot - Party slot index (0-5).
 * @returns {Promise<object|null>} An object containing key data, or null on error.
 */
export async function getPokemonData(slot) {
    try {
        const nickname = await getPokemonNickname(slot);
        const pid = await getPokemonPID(slot);
        const otid = await getPokemonOTID(slot);

        const encryptedBlock = await getEncryptedBlock(slot);
        if (!encryptedBlock || encryptedBlock.byteLength !== CONSTANTS.ENCRYPTED_BLOCK_SIZE) {
            console.error(`[getPokemonData] Failed to read encrypted block for slot ${slot}. PID: ${pid}`);
            return null;
        }
        
        const decryptedBlock = decryptBlock(encryptedBlock, pid, otid);
        const substructures = unshuffleSubstructures(decryptedBlock, pid);

        if (!substructures.G || !substructures.M || !substructures.A || !substructures.E) {
            console.warn(`[getPokemonData] Invalid or incomplete substructures for slot ${slot}. PID: ${pid}. G:${!!substructures.G}, A:${!!substructures.A}, E:${!!substructures.E}, M:${!!substructures.M}`);
            return null;
        }

        const speciesId = getSpeciesId(substructures.G);
        if (speciesId === CONSTANTS.SPECIES_NONE) {
            // console.debug(`[getPokemonData] Slot ${slot} confirmed empty (SPECIES_NONE). PID: ${pid}.`);
            return null; // Definitely an empty slot
        }

        // Data from unencrypted part or requires speciesId/abilitySlot
        const level = await getPokemonLevel(slot);
        const statusCondition = await getPokemonStatusCondition(slot);
        const currentHP = await getPokemonCurrentHP(slot);
        const maxHP = await getPokemonMaxHP(slot);
        
        const ivBitfield = getIVsEggAbilityBitfield(substructures.M);
        const abilitySlot = getAbilitySlot(ivBitfield);

        // Fetch types and ability name
        const types = await getTypes(speciesId);
        const abilityName = await getAbility(abilitySlot, speciesId);

        return {
            nickname: nickname,
            pid: pid,
            otid: otid,
            level: level,
            species: getSpeciesName(speciesId), // Use direct speciesId
            speciesId: speciesId, // Include speciesId
            types: types, // Added
            ability: abilityName, // Added
            statusCondition: statusCondition,
            currentHP: currentHP,
            maxHP: maxHP,
            heldItemId: getHeldItem(substructures.G),
            experience: getExperience(substructures.G),
            friendship: getFriendship(substructures.G),
            ppBonuses: getPPBonuses(substructures.G),
            moves: [
                getMoveName(getMove(substructures.A, 0)),
                getMoveName(getMove(substructures.A, 1)),
                getMoveName(getMove(substructures.A, 2)),
                getMoveName(getMove(substructures.A, 3)),
            ],
            currentPP: [
                getCurrentPP(substructures.A, 0),
                getCurrentPP(substructures.A, 1),
                getCurrentPP(substructures.A, 2),
                getCurrentPP(substructures.A, 3)
            ],
            evs: {
                hp: getEV(substructures.E, 0),
                attack: getEV(substructures.E, 1),
                defense: getEV(substructures.E, 2),
                speed: getEV(substructures.E, 3),
                spAttack: getEV(substructures.E, 4),
                spDefense: getEV(substructures.E, 5)
            },
            ivs: {
                hp: getIV(ivBitfield, 0),
                attack: getIV(ivBitfield, 1),
                defense: getIV(ivBitfield, 2),
                speed: getIV(ivBitfield, 3),
                spAttack: getIV(ivBitfield, 4),
                spDefense: getIV(ivBitfield, 5)
            },
            isEgg: isEgg(ivBitfield),
            abilitySlot: getAbilitySlot(ivBitfield), // 0 or 1
            metLocation: getMetLocation(substructures.M),
            pokerus: getPokerusStatus(substructures.M),
            originsInfo: getOriginsInfo(substructures.M),
            ribbonsObedience: getRibbonsObedience(substructures.M),
        };

    } catch (error) {
        // Log specific errors if they are known, otherwise generic
        if (error.message && (error.message.includes("Invalid Growth buffer") || error.message.includes("Invalid Misc buffer"))) {
            console.warn(`[getPokemonData] Error processing substructures for slot ${slot} (likely empty/corrupted):`, error.message);
        } else {
            console.error(`[getPokemonData] General error getting data for slot ${slot}:`, error);
        }
        return null;
    }
}