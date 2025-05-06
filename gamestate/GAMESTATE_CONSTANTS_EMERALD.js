// --- Bag Memory Addresses and Constants ---
export const BAG_MAIN_ADDR = 0x02039DD8;                // Start address of the bag pocket pointers and sizes
export const SECURITY_KEY_POINTER_ADDR = 0x03005D90;    // Address holding the pointer to the save block containing the key
export const SECURITY_KEY_OFFSET = 0x01F4;              // Offset within the save block to find the security key

// --- Party Pokémon Data Constants ---
export const IN_BATTLE_BIT_ADDR = 0x30026F9;            // Location of the bitmask determining if the player is in battle
export const PARTY_BASE_ADDR = 0x020244EC;              // Base address for party Pokémon data [1]

// --- Script Context Constants ---
// There's probably horrific issues this is going to cause down the line, but I noticed this pointer only seems to be set
// when there's an overworld text box open, so...
export const SCRIPT_CONTEXT_ADDRESS = 0x03000E40;       // Pointer to the sGlobalScriptContext object with script state