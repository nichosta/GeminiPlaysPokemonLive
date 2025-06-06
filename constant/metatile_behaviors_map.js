// This file doesn't have a counterpart for FRLG. Fix this if you need to use it.

export const metatileBehaviorMap = new Map([
    [0x00, "NORMAL"],
    [0x01, "SECRET_BASE_WALL"],
    [0x02, "TALL_GRASS"],
    [0x03, "LONG_GRASS"],
    [0x04, "UNUSED_04"],
    [0x05, "UNUSED_05"],
    [0x06, "DEEP_SAND"],
    [0x07, "SHORT_GRASS"],
    [0x08, "CAVE"],
    [0x09, "LONG_GRASS_SOUTH_EDGE"],
    [0x0A, "NO_RUNNING"],
    [0x0B, "INDOOR_ENCOUNTER"],
    [0x0C, "MOUNTAIN_TOP"],
    [0x0D, "BATTLE_PYRAMID_WARP"],
    [0x0E, "MOSSDEEP_GYM_WARP"],
    [0x0F, "MT_PYRE_HOLE"],
    [0x10, "POND_WATER"],
    [0x11, "INTERIOR_DEEP_WATER"],
    [0x12, "DEEP_WATER"],
    [0x13, "WATERFALL"],
    [0x14, "SOOTOPOLIS_DEEP_WATER"],
    [0x15, "OCEAN_WATER"],
    [0x16, "PUDDLE"],
    [0x17, "SHALLOW_WATER"],
    [0x18, "UNUSED_SOOTOPOLIS_DEEP_WATER"],
    [0x19, "NO_SURFACING"],
    [0x1A, "UNUSED_SOOTOPOLIS_DEEP_WATER_2"],
    [0x1B, "STAIRS_OUTSIDE_ABANDONED_SHIP"],
    [0x1C, "SHOAL_CAVE_ENTRANCE"],
    [0x1D, "UNUSED_1D"],
    [0x1E, "UNUSED_1E"],
    [0x1F, "UNUSED_1F"],
    [0x20, "ICE"],
    [0x21, "SAND"],
    [0x22, "SEAWEED"],
    [0x23, "UNUSED_23"],
    [0x24, "ASHGRASS"],
    [0x25, "FOOTPRINTS"],
    [0x26, "THIN_ICE"],
    [0x27, "CRACKED_ICE"],
    [0x28, "HOT_SPRINGS"],
    [0x29, "LAVARIDGE_GYM_B1F_WARP"],
    [0x2A, "SEAWEED_NO_SURFACING"],
    [0x2B, "REFLECTION_UNDER_BRIDGE"],
    [0x2C, "UNUSED_2C"],
    [0x2D, "UNUSED_2D"],
    [0x2E, "UNUSED_2E"],
    [0x2F, "UNUSED_2F"],
    [0x30, "IMPASSABLE_EAST"],
    [0x31, "IMPASSABLE_WEST"],
    [0x32, "IMPASSABLE_NORTH"],
    [0x33, "IMPASSABLE_SOUTH"],
    [0x34, "IMPASSABLE_NORTHEAST"],
    [0x35, "IMPASSABLE_NORTHWEST"],
    [0x36, "IMPASSABLE_SOUTHEAST"],
    [0x37, "IMPASSABLE_SOUTHWEST"],
    [0x38, "JUMP_EAST"],
    [0x39, "JUMP_WEST"],
    [0x3A, "JUMP_NORTH"],
    [0x3B, "JUMP_SOUTH"],
    [0x3C, "JUMP_NORTHEAST"],
    [0x3D, "JUMP_NORTHWEST"],
    [0x3E, "JUMP_SOUTHEAST"],
    [0x3F, "JUMP_SOUTHWEST"],
    [0x40, "WALK_EAST"],
    [0x41, "WALK_WEST"],
    [0x42, "WALK_NORTH"],
    [0x43, "WALK_SOUTH"],
    [0x44, "SLIDE_EAST"],
    [0x45, "SLIDE_WEST"],
    [0x46, "SLIDE_NORTH"],
    [0x47, "SLIDE_SOUTH"],
    [0x48, "TRICK_HOUSE_PUZZLE_8_FLOOR"],
    [0x49, "UNUSED_49"],
    [0x4A, "UNUSED_4A"],
    [0x4B, "UNUSED_4B"],
    [0x4C, "UNUSED_4C"],
    [0x4D, "UNUSED_4D"],
    [0x4E, "UNUSED_4E"],
    [0x4F, "UNUSED_4F"],
    [0x50, "EASTWARD_CURRENT"],
    [0x51, "WESTWARD_CURRENT"],
    [0x52, "NORTHWARD_CURRENT"],
    [0x53, "SOUTHWARD_CURRENT"],
    [0x54, "UNUSED_54"],
    [0x55, "UNUSED_55"],
    [0x56, "UNUSED_56"],
    [0x57, "UNUSED_57"],
    [0x58, "UNUSED_58"],
    [0x59, "UNUSED_59"],
    [0x5A, "UNUSED_5A"],
    [0x5B, "UNUSED_5B"],
    [0x5C, "UNUSED_5C"],
    [0x5D, "UNUSED_5D"],
    [0x5E, "UNUSED_5E"],
    [0x5F, "UNUSED_5F"],
    [0x60, "NON_ANIMATED_DOOR"],
    [0x61, "LADDER"],
    [0x62, "EAST_ARROW_WARP"],
    [0x63, "WEST_ARROW_WARP"],
    [0x64, "NORTH_ARROW_WARP"],
    [0x65, "SOUTH_ARROW_WARP"],
    [0x66, "CRACKED_FLOOR_HOLE"],
    [0x67, "AQUA_HIDEOUT_WARP"],
    [0x68, "LAVARIDGE_GYM_1F_WARP"],
    [0x69, "ANIMATED_DOOR"],
    [0x6A, "UP_ESCALATOR"],
    [0x6B, "DOWN_ESCALATOR"],
    [0x6C, "WATER_DOOR"],
    [0x6D, "WATER_SOUTH_ARROW_WARP"],
    [0x6E, "DEEP_SOUTH_WARP"],
    [0x6F, "UNUSED_6F"],
    [0x70, "BRIDGE_OVER_OCEAN"],
    [0x71, "BRIDGE_OVER_POND_LOW"],
    [0x72, "BRIDGE_OVER_POND_MED"],
    [0x73, "BRIDGE_OVER_POND_HIGH"],
    [0x74, "PACIFIDLOG_VERTICAL_LOG_TOP"],
    [0x75, "PACIFIDLOG_VERTICAL_LOG_BOTTOM"],
    [0x76, "PACIFIDLOG_HORIZONTAL_LOG_LEFT"],
    [0x77, "PACIFIDLOG_HORIZONTAL_LOG_RIGHT"],
    [0x78, "FORTREE_BRIDGE"],
    [0x79, "UNUSED_79"],
    [0x7A, "BRIDGE_OVER_POND_MED_EDGE_1"],
    [0x7B, "BRIDGE_OVER_POND_MED_EDGE_2"],
    [0x7C, "BRIDGE_OVER_POND_HIGH_EDGE_1"],
    [0x7D, "BRIDGE_OVER_POND_HIGH_EDGE_2"],
    [0x7E, "UNUSED_BRIDGE"],
    [0x7F, "BIKE_BRIDGE_OVER_BARRIER"],
    [0x80, "COUNTER"],
    [0x81, "UNUSED_81"],
    [0x82, "UNUSED_82"],
    [0x83, "PC"],
    [0x84, "CABLE_BOX_RESULTS_1"],
    [0x85, "REGION_MAP"],
    [0x86, "TELEVISION"],
    [0x87, "POKEBLOCK_FEEDER"],
    [0x88, "UNUSED_88"],
    [0x89, "SLOT_MACHINE"],
    [0x8A, "ROULETTE"],
    [0x8B, "CLOSED_SOOTOPOLIS_DOOR"],
    [0x8C, "TRICK_HOUSE_PUZZLE_DOOR"],
    [0x8D, "PETALBURG_GYM_DOOR"],
    [0x8E, "RUNNING_SHOES_INSTRUCTION"],
    [0x8F, "QUESTIONNAIRE"],
    [0x90, "SECRET_BASE_SPOT_RED_CAVE"],
    [0x91, "SECRET_BASE_SPOT_RED_CAVE_OPEN"],
    [0x92, "SECRET_BASE_SPOT_BROWN_CAVE"],
    [0x93, "SECRET_BASE_SPOT_BROWN_CAVE_OPEN"],
    [0x94, "SECRET_BASE_SPOT_YELLOW_CAVE"],
    [0x95, "SECRET_BASE_SPOT_YELLOW_CAVE_OPEN"],
    [0x96, "SECRET_BASE_SPOT_TREE_LEFT"],
    [0x97, "SECRET_BASE_SPOT_TREE_LEFT_OPEN"],
    [0x98, "SECRET_BASE_SPOT_SHRUB"],
    [0x99, "SECRET_BASE_SPOT_SHRUB_OPEN"],
    [0x9A, "SECRET_BASE_SPOT_BLUE_CAVE"],
    [0x9B, "SECRET_BASE_SPOT_BLUE_CAVE_OPEN"],
    [0x9C, "SECRET_BASE_SPOT_TREE_RIGHT"],
    [0x9D, "SECRET_BASE_SPOT_TREE_RIGHT_OPEN"],
    [0x9E, "UNUSED_9E"],
    [0x9F, "UNUSED_9F"],
    [0xA0, "BERRY_TREE_SOIL"],
    [0xA1, "UNUSED_A1"],
    [0xA2, "UNUSED_A2"],
    [0xA3, "UNUSED_A3"],
    [0xA4, "UNUSED_A4"],
    [0xA5, "UNUSED_A5"],
    [0xA6, "UNUSED_A6"],
    [0xA7, "UNUSED_A7"],
    [0xA8, "UNUSED_A8"],
    [0xA9, "UNUSED_A9"],
    [0xAA, "UNUSED_AA"],
    [0xAB, "UNUSED_AB"],
    [0xAC, "UNUSED_AC"],
    [0xAD, "UNUSED_AD"],
    [0xAE, "UNUSED_AE"],
    [0xAF, "UNUSED_AF"],
    [0xB0, "SECRET_BASE_PC"],
    [0xB1, "SECRET_BASE_REGISTER_PC"],
    [0xB2, "SECRET_BASE_SCENERY"],
    [0xB3, "SECRET_BASE_TRAINER_SPOT"],
    [0xB4, "SECRET_BASE_DECORATION"],
    [0xB5, "HOLDS_SMALL_DECORATION"],
    [0xB6, "UNUSED_B6"],
    [0xB7, "SECRET_BASE_NORTH_WALL"],
    [0xB8, "SECRET_BASE_BALLOON"],
    [0xB9, "SECRET_BASE_IMPASSABLE"],
    [0xBA, "SECRET_BASE_GLITTER_MAT"],
    [0xBB, "SECRET_BASE_JUMP_MAT"],
    [0xBC, "SECRET_BASE_SPIN_MAT"],
    [0xBD, "SECRET_BASE_SOUND_MAT"],
    [0xBE, "SECRET_BASE_BREAKABLE_DOOR"],
    [0xBF, "SECRET_BASE_SAND_ORNAMENT"],
    [0xC0, "IMPASSABLE_SOUTH_AND_NORTH"],
    [0xC1, "IMPASSABLE_WEST_AND_EAST"],
    [0xC2, "SECRET_BASE_HOLE"],
    [0xC3, "HOLDS_LARGE_DECORATION"],
    [0xC4, "SECRET_BASE_TV_SHIELD"],
    [0xC5, "PLAYER_ROOM_PC_ON"],
    [0xC6, "SECRET_BASE_DECORATION_BASE"],
    [0xC7, "SECRET_BASE_POSTER"],
    [0xC8, "UNUSED_C8"],
    [0xC9, "UNUSED_C9"],
    [0xCA, "UNUSED_CA"],
    [0xCB, "UNUSED_CB"],
    [0xCC, "UNUSED_CC"],
    [0xCD, "UNUSED_CD"],
    [0xCE, "UNUSED_CE"],
    [0xCF, "UNUSED_CF"],
    [0xD0, "MUDDY_SLOPE"],
    [0xD1, "BUMPY_SLOPE"],
    [0xD2, "CRACKED_FLOOR"],
    [0xD3, "ISOLATED_VERTICAL_RAIL"],
    [0xD4, "ISOLATED_HORIZONTAL_RAIL"],
    [0xD5, "VERTICAL_RAIL"],
    [0xD6, "HORIZONTAL_RAIL"],
    [0xD7, "UNUSED_D7"],
    [0xD8, "UNUSED_D8"],
    [0xD9, "UNUSED_D9"],
    [0xDA, "UNUSED_DA"],
    [0xDB, "UNUSED_DB"],
    [0xDC, "UNUSED_DC"],
    [0xDD, "UNUSED_DD"],
    [0xDE, "UNUSED_DE"],
    [0xDF, "UNUSED_DF"],
    [0xE0, "PICTURE_BOOK_SHELF"],
    [0xE1, "BOOKSHELF"],
    [0xE2, "POKEMON_CENTER_BOOKSHELF"],
    [0xE3, "VASE"],
    [0xE4, "TRASH_CAN"],
    [0xE5, "SHOP_SHELF"],
    [0xE6, "BLUEPRINT"],
    [0xE7, "CABLE_BOX_RESULTS_2"],
    [0xE8, "WIRELESS_BOX_RESULTS"],
    [0xE9, "TRAINER_HILL_TIMER"],
    [0xEA, "SKY_PILLAR_CLOSED_DOOR"],
    [0xEB, "UNUSED_EB"],
    [0xEC, "UNUSED_EC"],
    [0xED, "UNUSED_ED"],
    [0xEE, "UNUSED_EE"],
    [0xEF, "UNUSED_EF"],
    [0xFF, "INVALID"]
]);

/**
 * @description Gets the metatile behavior name from the metatile behavior ID.
 * @param {number} behaviorId - The metatile behavior ID.
 * @returns {string | undefined} The metatile behavior name or undefined if not found.
 */
export function getMetatileBehaviorName(behaviorId) {
    return metatileBehaviorMap.get(behaviorId);
}

export const WATER_TILES = new Set([
    "POND_WATER",
    "OCEAN_WATER",
    "INTERIOR_DEEP_WATER",
    "DEEP_WATER",
    "SOOTOPOLIS_DEEP_WATER",
    "EASTWARD_CURRENT",
    "WESTWARD_CURRENT",
    "NORTHWARD_CURRENT",
    "SOUTHWARD_CURRENT",
    "BRIDGE_OVER_OCEAN",
    "BRIDGE_OVER_POND_LOW",
    "BRIDGE_OVER_POND_MED",
    "BRIDGE_OVER_POND_HIGH",
]);

export const WATERFALL_TILE = "WATERFALL";

export const DIVE_TILES = new Set([
    "DEEP_WATER",
    "SOOTOPOLIS_DEEP_WATER",
    "INTERIOR_DEEP_WATER",
]);


export const WARP_METATILES = new Set([
    "EAST_ARROW_WARP",
    "WEST_ARROW_WARP",
    "NORTH_ARROW_WARP",
    "SOUTH_ARROW_WARP",
    "PETALBURG_GYM_DOOR",
    "MOSSDEEP_GYM_WARP",
    "AQUA_HIDEOUT_WARP",
    "LAVARIDGE_GYM_1F_WARP",
    "LAVARIDGE_GYM_B1F_WARP",
    "UP_ESCALATOR",
    "DOWN_ESCALATOR",
    "NON_ANIMATED_DOOR",
    "ANIMATED_DOOR",
    "LADDER",
    "WATER_DOOR",
    "WATER_SOUTH_ARROW_WARP",
    "DEEP_SOUTH_WARP",
    "STAIRS_OUTSIDE_ABANDONED_SHIP",
    "SHOAL_CAVE_ENTRANCE"
])

export const LEDGE_DIRECTIONS = new Map([
    ["JUMP_EAST", "➡️"],
    ["JUMP_WEST", "⬅️"],
    ["JUMP_NORTH", "⬆️"],
    ["JUMP_SOUTH", "⬇️"]
]);

export const WARP_DIRECTIONS = new Map([
    ["EAST_ARROW_WARP", "→"],
    ["WEST_ARROW_WARP", "←"],
    ["NORTH_ARROW_WARP", "↑"],
    ["STAIRS_OUTSIDE_ABANDONED_SHIP", "↑"],
    ["SOUTH_ARROW_WARP", "↓"],
    ["SHOAL_CAVE_ENTRANCE", "↓"],
    ["WATER_SOUTH_ARROW_WARP", "↓"],
]);