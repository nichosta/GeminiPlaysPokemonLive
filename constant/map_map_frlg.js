// Gemini 2.5 Pro asked me for credit for this file
// Author: Gemini 2.5 Pro
// If you see this, feel free to make a pull request making some of the map names clearer
const mapLookup = new Map();

// Helper to add entries, assuming mapNum is the unique key within a group
function addMap(groupNum, mapNum, mapName) {
    if (!mapLookup.has(groupNum)) {
        mapLookup.set(groupNum, new Map());
    }
    mapLookup.get(groupNum).set(mapNum, mapName);
}

// gMapGroup_Link
addMap(0, 0, "MAP_BATTLE_COLOSSEUM_2P");
addMap(0, 1, "MAP_TRADE_CENTER");
addMap(0, 2, "MAP_RECORD_CORNER");
addMap(0, 3, "MAP_BATTLE_COLOSSEUM_4P");
addMap(0, 4, "MAP_UNION_ROOM");

// gMapGroup_Dungeons
addMap(1, 0, "MAP_VIRIDIAN_FOREST");
addMap(1, 1, "MAP_MT_MOON_1F");
addMap(1, 2, "MAP_MT_MOON_B1F");
addMap(1, 3, "MAP_MT_MOON_B2F");
addMap(1, 4, "MAP_SSANNE_EXTERIOR");
addMap(1, 5, "MAP_SSANNE_1F_CORRIDOR");
addMap(1, 6, "MAP_SSANNE_2F_CORRIDOR");
addMap(1, 7, "MAP_SSANNE_3F_CORRIDOR");
addMap(1, 8, "MAP_SSANNE_B1F_CORRIDOR");
addMap(1, 9, "MAP_SSANNE_DECK");
addMap(1, 10, "MAP_SSANNE_KITCHEN");
addMap(1, 11, "MAP_SSANNE_CAPTAINS_OFFICE");
addMap(1, 12, "MAP_SSANNE_1F_ROOM1");
addMap(1, 13, "MAP_SSANNE_1F_ROOM2");
addMap(1, 14, "MAP_SSANNE_1F_ROOM3");
addMap(1, 15, "MAP_SSANNE_1F_ROOM4");
addMap(1, 16, "MAP_SSANNE_1F_ROOM5");
addMap(1, 17, "MAP_SSANNE_1F_ROOM7");
addMap(1, 18, "MAP_SSANNE_2F_ROOM1");
addMap(1, 19, "MAP_SSANNE_2F_ROOM2");
addMap(1, 20, "MAP_SSANNE_2F_ROOM3");
addMap(1, 21, "MAP_SSANNE_2F_ROOM4");
addMap(1, 22, "MAP_SSANNE_2F_ROOM5");
addMap(1, 23, "MAP_SSANNE_2F_ROOM6");
addMap(1, 24, "MAP_SSANNE_B1F_ROOM1");
addMap(1, 25, "MAP_SSANNE_B1F_ROOM2");
addMap(1, 26, "MAP_SSANNE_B1F_ROOM3");
addMap(1, 27, "MAP_SSANNE_B1F_ROOM4");
addMap(1, 28, "MAP_SSANNE_B1F_ROOM5");
addMap(1, 29, "MAP_SSANNE_1F_ROOM6");
addMap(1, 30, "MAP_UNDERGROUND_PATH_NORTH_ENTRANCE");
addMap(1, 31, "MAP_UNDERGROUND_PATH_NORTH_SOUTH_TUNNEL");
addMap(1, 32, "MAP_UNDERGROUND_PATH_SOUTH_ENTRANCE");
addMap(1, 33, "MAP_UNDERGROUND_PATH_WEST_ENTRANCE");
addMap(1, 34, "MAP_UNDERGROUND_PATH_EAST_WEST_TUNNEL");
addMap(1, 35, "MAP_UNDERGROUND_PATH_EAST_ENTRANCE");
addMap(1, 36, "MAP_DIGLETTS_CAVE_NORTH_ENTRANCE");
addMap(1, 37, "MAP_DIGLETTS_CAVE_B1F");
addMap(1, 38, "MAP_DIGLETTS_CAVE_SOUTH_ENTRANCE");
addMap(1, 39, "MAP_VICTORY_ROAD_1F");
addMap(1, 40, "MAP_VICTORY_ROAD_2F");
addMap(1, 41, "MAP_VICTORY_ROAD_3F");
addMap(1, 42, "MAP_ROCKET_HIDEOUT_B1F");
addMap(1, 43, "MAP_ROCKET_HIDEOUT_B2F");
addMap(1, 44, "MAP_ROCKET_HIDEOUT_B3F");
addMap(1, 45, "MAP_ROCKET_HIDEOUT_B4F");
addMap(1, 46, "MAP_ROCKET_HIDEOUT_ELEVATOR");
addMap(1, 47, "MAP_SILPH_CO_1F");
addMap(1, 48, "MAP_SILPH_CO_2F");
addMap(1, 49, "MAP_SILPH_CO_3F");
addMap(1, 50, "MAP_SILPH_CO_4F");
addMap(1, 51, "MAP_SILPH_CO_5F");
addMap(1, 52, "MAP_SILPH_CO_6F");
addMap(1, 53, "MAP_SILPH_CO_7F");
addMap(1, 54, "MAP_SILPH_CO_8F");
addMap(1, 55, "MAP_SILPH_CO_9F");
addMap(1, 56, "MAP_SILPH_CO_10F");
addMap(1, 57, "MAP_SILPH_CO_11F");
addMap(1, 58, "MAP_SILPH_CO_ELEVATOR");
addMap(1, 59, "MAP_POKEMON_MANSION_1F");
addMap(1, 60, "MAP_POKEMON_MANSION_2F");
addMap(1, 61, "MAP_POKEMON_MANSION_3F");
addMap(1, 62, "MAP_POKEMON_MANSION_B1F");
addMap(1, 63, "MAP_SAFARI_ZONE_CENTER");
addMap(1, 64, "MAP_SAFARI_ZONE_EAST");
addMap(1, 65, "MAP_SAFARI_ZONE_NORTH");
addMap(1, 66, "MAP_SAFARI_ZONE_WEST");
addMap(1, 67, "MAP_SAFARI_ZONE_CENTER_REST_HOUSE");
addMap(1, 68, "MAP_SAFARI_ZONE_EAST_REST_HOUSE");
addMap(1, 69, "MAP_SAFARI_ZONE_NORTH_REST_HOUSE");
addMap(1, 70, "MAP_SAFARI_ZONE_WEST_REST_HOUSE");
addMap(1, 71, "MAP_SAFARI_ZONE_SECRET_HOUSE");
addMap(1, 72, "MAP_CERULEAN_CAVE_1F");
addMap(1, 73, "MAP_CERULEAN_CAVE_2F");
addMap(1, 74, "MAP_CERULEAN_CAVE_B1F");
addMap(1, 75, "MAP_POKEMON_LEAGUE_LORELEIS_ROOM");
addMap(1, 76, "MAP_POKEMON_LEAGUE_BRUNOS_ROOM");
addMap(1, 77, "MAP_POKEMON_LEAGUE_AGATHAS_ROOM");
addMap(1, 78, "MAP_POKEMON_LEAGUE_LANCES_ROOM");
addMap(1, 79, "MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM");
addMap(1, 80, "MAP_POKEMON_LEAGUE_HALL_OF_FAME");
addMap(1, 81, "MAP_ROCK_TUNNEL_1F");
addMap(1, 82, "MAP_ROCK_TUNNEL_B1F");
addMap(1, 83, "MAP_SEAFOAM_ISLANDS_1F");
addMap(1, 84, "MAP_SEAFOAM_ISLANDS_B1F");
addMap(1, 85, "MAP_SEAFOAM_ISLANDS_B2F");
addMap(1, 86, "MAP_SEAFOAM_ISLANDS_B3F");
addMap(1, 87, "MAP_SEAFOAM_ISLANDS_B4F");
addMap(1, 88, "MAP_POKEMON_TOWER_1F");
addMap(1, 89, "MAP_POKEMON_TOWER_2F");
addMap(1, 90, "MAP_POKEMON_TOWER_3F");
addMap(1, 91, "MAP_POKEMON_TOWER_4F");
addMap(1, 92, "MAP_POKEMON_TOWER_5F");
addMap(1, 93, "MAP_POKEMON_TOWER_6F");
addMap(1, 94, "MAP_POKEMON_TOWER_7F");
addMap(1, 95, "MAP_POWER_PLANT");
addMap(1, 96, "MAP_MT_EMBER_RUBY_PATH_B4F");
addMap(1, 97, "MAP_MT_EMBER_EXTERIOR");
addMap(1, 98, "MAP_MT_EMBER_SUMMIT_PATH_1F");
addMap(1, 99, "MAP_MT_EMBER_SUMMIT_PATH_2F");
addMap(1, 100, "MAP_MT_EMBER_SUMMIT_PATH_3F");
addMap(1, 101, "MAP_MT_EMBER_SUMMIT");
addMap(1, 102, "MAP_MT_EMBER_RUBY_PATH_B5F");
addMap(1, 103, "MAP_MT_EMBER_RUBY_PATH_1F");
addMap(1, 104, "MAP_MT_EMBER_RUBY_PATH_B1F");
addMap(1, 105, "MAP_MT_EMBER_RUBY_PATH_B2F");
addMap(1, 106, "MAP_MT_EMBER_RUBY_PATH_B3F");
addMap(1, 107, "MAP_MT_EMBER_RUBY_PATH_B1F_STAIRS");
addMap(1, 108, "MAP_MT_EMBER_RUBY_PATH_B2F_STAIRS");
addMap(1, 109, "MAP_THREE_ISLAND_BERRY_FOREST");
addMap(1, 110, "MAP_FOUR_ISLAND_ICEFALL_CAVE_ENTRANCE");
addMap(1, 111, "MAP_FOUR_ISLAND_ICEFALL_CAVE_1F");
addMap(1, 112, "MAP_FOUR_ISLAND_ICEFALL_CAVE_B1F");
addMap(1, 113, "MAP_FOUR_ISLAND_ICEFALL_CAVE_BACK");
addMap(1, 114, "MAP_FIVE_ISLAND_ROCKET_WAREHOUSE");
addMap(1, 115, "MAP_SIX_ISLAND_DOTTED_HOLE_1F");
addMap(1, 116, "MAP_SIX_ISLAND_DOTTED_HOLE_B1F");
addMap(1, 117, "MAP_SIX_ISLAND_DOTTED_HOLE_B2F");
addMap(1, 118, "MAP_SIX_ISLAND_DOTTED_HOLE_B3F");
addMap(1, 119, "MAP_SIX_ISLAND_DOTTED_HOLE_B4F");
addMap(1, 120, "MAP_SIX_ISLAND_DOTTED_HOLE_SAPPHIRE_ROOM");
addMap(1, 121, "MAP_SIX_ISLAND_PATTERN_BUSH");
addMap(1, 122, "MAP_SIX_ISLAND_ALTERING_CAVE");

// gMapGroup_SpecialArea
addMap(2, 0, "MAP_NAVEL_ROCK_EXTERIOR");
addMap(2, 1, "MAP_TRAINER_TOWER_1F");
addMap(2, 2, "MAP_TRAINER_TOWER_2F");
addMap(2, 3, "MAP_TRAINER_TOWER_3F");
addMap(2, 4, "MAP_TRAINER_TOWER_4F");
addMap(2, 5, "MAP_TRAINER_TOWER_5F");
addMap(2, 6, "MAP_TRAINER_TOWER_6F");
addMap(2, 7, "MAP_TRAINER_TOWER_7F");
addMap(2, 8, "MAP_TRAINER_TOWER_8F");
addMap(2, 9, "MAP_TRAINER_TOWER_ROOF");
addMap(2, 10, "MAP_TRAINER_TOWER_LOBBY");
addMap(2, 11, "MAP_TRAINER_TOWER_ELEVATOR");
addMap(2, 12, "MAP_FIVE_ISLAND_LOST_CAVE_ENTRANCE");
addMap(2, 13, "MAP_FIVE_ISLAND_LOST_CAVE_ROOM1");
addMap(2, 14, "MAP_FIVE_ISLAND_LOST_CAVE_ROOM2");
addMap(2, 15, "MAP_FIVE_ISLAND_LOST_CAVE_ROOM3");
addMap(2, 16, "MAP_FIVE_ISLAND_LOST_CAVE_ROOM4");
addMap(2, 17, "MAP_FIVE_ISLAND_LOST_CAVE_ROOM5");
addMap(2, 18, "MAP_FIVE_ISLAND_LOST_CAVE_ROOM6");
addMap(2, 19, "MAP_FIVE_ISLAND_LOST_CAVE_ROOM7");
addMap(2, 20, "MAP_FIVE_ISLAND_LOST_CAVE_ROOM8");
addMap(2, 21, "MAP_FIVE_ISLAND_LOST_CAVE_ROOM9");
addMap(2, 22, "MAP_FIVE_ISLAND_LOST_CAVE_ROOM10");
addMap(2, 23, "MAP_FIVE_ISLAND_LOST_CAVE_ROOM11");
addMap(2, 24, "MAP_FIVE_ISLAND_LOST_CAVE_ROOM12");
addMap(2, 25, "MAP_FIVE_ISLAND_LOST_CAVE_ROOM13");
addMap(2, 26, "MAP_FIVE_ISLAND_LOST_CAVE_ROOM14");
addMap(2, 27, "MAP_SEVEN_ISLAND_TANOBY_RUINS_MONEAN_CHAMBER");
addMap(2, 28, "MAP_SEVEN_ISLAND_TANOBY_RUINS_LIPTOO_CHAMBER");
addMap(2, 29, "MAP_SEVEN_ISLAND_TANOBY_RUINS_WEEPTH_CHAMBER");
addMap(2, 30, "MAP_SEVEN_ISLAND_TANOBY_RUINS_DILFORD_CHAMBER");
addMap(2, 31, "MAP_SEVEN_ISLAND_TANOBY_RUINS_SCUFIB_CHAMBER");
addMap(2, 32, "MAP_SEVEN_ISLAND_TANOBY_RUINS_RIXY_CHAMBER");
addMap(2, 33, "MAP_SEVEN_ISLAND_TANOBY_RUINS_VIAPOIS_CHAMBER");
addMap(2, 34, "MAP_THREE_ISLAND_DUNSPARCE_TUNNEL");
addMap(2, 35, "MAP_SEVEN_ISLAND_SEVAULT_CANYON_TANOBY_KEY");
addMap(2, 36, "MAP_NAVEL_ROCK_1F");
addMap(2, 37, "MAP_NAVEL_ROCK_SUMMIT");
addMap(2, 38, "MAP_NAVEL_ROCK_BASE");
addMap(2, 39, "MAP_NAVEL_ROCK_SUMMIT_PATH_2F");
addMap(2, 40, "MAP_NAVEL_ROCK_SUMMIT_PATH_3F");
addMap(2, 41, "MAP_NAVEL_ROCK_SUMMIT_PATH_4F");
addMap(2, 42, "MAP_NAVEL_ROCK_SUMMIT_PATH_5F");
addMap(2, 43, "MAP_NAVEL_ROCK_BASE_PATH_B1F");
addMap(2, 44, "MAP_NAVEL_ROCK_BASE_PATH_B2F");
addMap(2, 45, "MAP_NAVEL_ROCK_BASE_PATH_B3F");
addMap(2, 46, "MAP_NAVEL_ROCK_BASE_PATH_B4F");
addMap(2, 47, "MAP_NAVEL_ROCK_BASE_PATH_B5F");
addMap(2, 48, "MAP_NAVEL_ROCK_BASE_PATH_B6F");
addMap(2, 49, "MAP_NAVEL_ROCK_BASE_PATH_B7F");
addMap(2, 50, "MAP_NAVEL_ROCK_BASE_PATH_B8F");
addMap(2, 51, "MAP_NAVEL_ROCK_BASE_PATH_B9F");
addMap(2, 52, "MAP_NAVEL_ROCK_BASE_PATH_B10F");
addMap(2, 53, "MAP_NAVEL_ROCK_BASE_PATH_B11F");
addMap(2, 54, "MAP_NAVEL_ROCK_B1F");
addMap(2, 55, "MAP_NAVEL_ROCK_FORK");
addMap(2, 56, "MAP_BIRTH_ISLAND_EXTERIOR");
addMap(2, 57, "MAP_ONE_ISLAND_KINDLE_ROAD_EMBER_SPA");
addMap(2, 58, "MAP_BIRTH_ISLAND_HARBOR");
addMap(2, 59, "MAP_NAVEL_ROCK_HARBOR");

// gMapGroup_TownsAndRoutes
addMap(3, 0, "MAP_PALLET_TOWN");
addMap(3, 1, "MAP_VIRIDIAN_CITY");
addMap(3, 2, "MAP_PEWTER_CITY");
addMap(3, 3, "MAP_CERULEAN_CITY");
addMap(3, 4, "MAP_LAVENDER_TOWN");
addMap(3, 5, "MAP_VERMILION_CITY");
addMap(3, 6, "MAP_CELADON_CITY");
addMap(3, 7, "MAP_FUCHSIA_CITY");
addMap(3, 8, "MAP_CINNABAR_ISLAND");
addMap(3, 9, "MAP_INDIGO_PLATEAU_EXTERIOR");
addMap(3, 10, "MAP_SAFFRON_CITY");
addMap(3, 11, "MAP_SAFFRON_CITY_CONNECTION");
addMap(3, 12, "MAP_ONE_ISLAND");
addMap(3, 13, "MAP_TWO_ISLAND");
addMap(3, 14, "MAP_THREE_ISLAND");
addMap(3, 15, "MAP_FOUR_ISLAND");
addMap(3, 16, "MAP_FIVE_ISLAND");
addMap(3, 17, "MAP_SEVEN_ISLAND");
addMap(3, 18, "MAP_SIX_ISLAND");
addMap(3, 19, "MAP_ROUTE1");
addMap(3, 20, "MAP_ROUTE2");
addMap(3, 21, "MAP_ROUTE3");
addMap(3, 22, "MAP_ROUTE4");
addMap(3, 23, "MAP_ROUTE5");
addMap(3, 24, "MAP_ROUTE6");
addMap(3, 25, "MAP_ROUTE7");
addMap(3, 26, "MAP_ROUTE8");
addMap(3, 27, "MAP_ROUTE9");
addMap(3, 28, "MAP_ROUTE10");
addMap(3, 29, "MAP_ROUTE11");
addMap(3, 30, "MAP_ROUTE12");
addMap(3, 31, "MAP_ROUTE13");
addMap(3, 32, "MAP_ROUTE14");
addMap(3, 33, "MAP_ROUTE15");
addMap(3, 34, "MAP_ROUTE16");
addMap(3, 35, "MAP_ROUTE17");
addMap(3, 36, "MAP_ROUTE18");
addMap(3, 37, "MAP_ROUTE19");
addMap(3, 38, "MAP_ROUTE20");
addMap(3, 39, "MAP_ROUTE21_NORTH");
addMap(3, 40, "MAP_ROUTE21_SOUTH");
addMap(3, 41, "MAP_ROUTE22");
addMap(3, 42, "MAP_ROUTE23");
addMap(3, 43, "MAP_ROUTE24");
addMap(3, 44, "MAP_ROUTE25");
addMap(3, 45, "MAP_ONE_ISLAND_KINDLE_ROAD");
addMap(3, 46, "MAP_ONE_ISLAND_TREASURE_BEACH");
addMap(3, 47, "MAP_TWO_ISLAND_CAPE_BRINK");
addMap(3, 48, "MAP_THREE_ISLAND_BOND_BRIDGE");
addMap(3, 49, "MAP_THREE_ISLAND_PORT");
addMap(3, 50, "MAP_PROTOTYPE_SEVII_ISLE_6");
addMap(3, 51, "MAP_PROTOTYPE_SEVII_ISLE_7");
addMap(3, 52, "MAP_PROTOTYPE_SEVII_ISLE_8");
addMap(3, 53, "MAP_PROTOTYPE_SEVII_ISLE_9");
addMap(3, 54, "MAP_FIVE_ISLAND_RESORT_GORGEOUS");
addMap(3, 55, "MAP_FIVE_ISLAND_WATER_LABYRINTH");
addMap(3, 56, "MAP_FIVE_ISLAND_MEADOW");
addMap(3, 57, "MAP_FIVE_ISLAND_MEMORIAL_PILLAR");
addMap(3, 58, "MAP_SIX_ISLAND_OUTCAST_ISLAND");
addMap(3, 59, "MAP_SIX_ISLAND_GREEN_PATH");
addMap(3, 60, "MAP_SIX_ISLAND_WATER_PATH");
addMap(3, 61, "MAP_SIX_ISLAND_RUIN_VALLEY");
addMap(3, 62, "MAP_SEVEN_ISLAND_TRAINER_TOWER");
addMap(3, 63, "MAP_SEVEN_ISLAND_SEVAULT_CANYON_ENTRANCE");
addMap(3, 64, "MAP_SEVEN_ISLAND_SEVAULT_CANYON");
addMap(3, 65, "MAP_SEVEN_ISLAND_TANOBY_RUINS");

// gMapGroup_IndoorPallet
addMap(4, 0, "MAP_PALLET_TOWN_PLAYERS_HOUSE_1F");
addMap(4, 1, "MAP_PALLET_TOWN_PLAYERS_HOUSE_2F");
addMap(4, 2, "MAP_PALLET_TOWN_RIVALS_HOUSE");
addMap(4, 3, "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB");

// gMapGroup_IndoorViridian
addMap(5, 0, "MAP_VIRIDIAN_CITY_HOUSE");
addMap(5, 1, "MAP_VIRIDIAN_CITY_GYM");
addMap(5, 2, "MAP_VIRIDIAN_CITY_SCHOOL");
addMap(5, 3, "MAP_VIRIDIAN_CITY_MART");
addMap(5, 4, "MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F");
addMap(5, 5, "MAP_VIRIDIAN_CITY_POKEMON_CENTER_2F");

// gMapGroup_IndoorPewter
addMap(6, 0, "MAP_PEWTER_CITY_MUSEUM_1F");
addMap(6, 1, "MAP_PEWTER_CITY_MUSEUM_2F");
addMap(6, 2, "MAP_PEWTER_CITY_GYM");
addMap(6, 3, "MAP_PEWTER_CITY_MART");
addMap(6, 4, "MAP_PEWTER_CITY_HOUSE1");
addMap(6, 5, "MAP_PEWTER_CITY_POKEMON_CENTER_1F");
addMap(6, 6, "MAP_PEWTER_CITY_POKEMON_CENTER_2F");
addMap(6, 7, "MAP_PEWTER_CITY_HOUSE2");

// gMapGroup_IndoorCerulean
addMap(7, 0, "MAP_CERULEAN_CITY_HOUSE1");
addMap(7, 1, "MAP_CERULEAN_CITY_HOUSE2");
addMap(7, 2, "MAP_CERULEAN_CITY_HOUSE3");
addMap(7, 3, "MAP_CERULEAN_CITY_POKEMON_CENTER_1F");
addMap(7, 4, "MAP_CERULEAN_CITY_POKEMON_CENTER_2F");
addMap(7, 5, "MAP_CERULEAN_CITY_GYM");
addMap(7, 6, "MAP_CERULEAN_CITY_BIKE_SHOP");
addMap(7, 7, "MAP_CERULEAN_CITY_MART");
addMap(7, 8, "MAP_CERULEAN_CITY_HOUSE4");
addMap(7, 9, "MAP_CERULEAN_CITY_HOUSE5");

// gMapGroup_IndoorLavender
addMap(8, 0, "MAP_LAVENDER_TOWN_POKEMON_CENTER_1F");
addMap(8, 1, "MAP_LAVENDER_TOWN_POKEMON_CENTER_2F");
addMap(8, 2, "MAP_LAVENDER_TOWN_VOLUNTEER_POKEMON_HOUSE");
addMap(8, 3, "MAP_LAVENDER_TOWN_HOUSE1");
addMap(8, 4, "MAP_LAVENDER_TOWN_HOUSE2");
addMap(8, 5, "MAP_LAVENDER_TOWN_MART");

// gMapGroup_IndoorVermilion
addMap(9, 0, "MAP_VERMILION_CITY_HOUSE1");
addMap(9, 1, "MAP_VERMILION_CITY_POKEMON_CENTER_1F");
addMap(9, 2, "MAP_VERMILION_CITY_POKEMON_CENTER_2F");
addMap(9, 3, "MAP_VERMILION_CITY_POKEMON_FAN_CLUB");
addMap(9, 4, "MAP_VERMILION_CITY_HOUSE2");
addMap(9, 5, "MAP_VERMILION_CITY_MART");
addMap(9, 6, "MAP_VERMILION_CITY_GYM");
addMap(9, 7, "MAP_VERMILION_CITY_HOUSE3");

// gMapGroup_IndoorCeladon
addMap(10, 0, "MAP_CELADON_CITY_DEPARTMENT_STORE_1F");
addMap(10, 1, "MAP_CELADON_CITY_DEPARTMENT_STORE_2F");
addMap(10, 2, "MAP_CELADON_CITY_DEPARTMENT_STORE_3F");
addMap(10, 3, "MAP_CELADON_CITY_DEPARTMENT_STORE_4F");
addMap(10, 4, "MAP_CELADON_CITY_DEPARTMENT_STORE_5F");
addMap(10, 5, "MAP_CELADON_CITY_DEPARTMENT_STORE_ROOF");
addMap(10, 6, "MAP_CELADON_CITY_DEPARTMENT_STORE_ELEVATOR");
addMap(10, 7, "MAP_CELADON_CITY_CONDOMINIUMS_1F");
addMap(10, 8, "MAP_CELADON_CITY_CONDOMINIUMS_2F");
addMap(10, 9, "MAP_CELADON_CITY_CONDOMINIUMS_3F");
addMap(10, 10, "MAP_CELADON_CITY_CONDOMINIUMS_ROOF");
addMap(10, 11, "MAP_CELADON_CITY_CONDOMINIUMS_ROOF_ROOM");
addMap(10, 12, "MAP_CELADON_CITY_POKEMON_CENTER_1F");
addMap(10, 13, "MAP_CELADON_CITY_POKEMON_CENTER_2F");
addMap(10, 14, "MAP_CELADON_CITY_GAME_CORNER");
addMap(10, 15, "MAP_CELADON_CITY_GAME_CORNER_PRIZE_ROOM");
addMap(10, 16, "MAP_CELADON_CITY_GYM");
addMap(10, 17, "MAP_CELADON_CITY_RESTAURANT");
addMap(10, 18, "MAP_CELADON_CITY_HOUSE1");
addMap(10, 19, "MAP_CELADON_CITY_HOTEL");

// gMapGroup_IndoorFuchsia
addMap(11, 0, "MAP_FUCHSIA_CITY_SAFARI_ZONE_ENTRANCE");
addMap(11, 1, "MAP_FUCHSIA_CITY_MART");
addMap(11, 2, "MAP_FUCHSIA_CITY_SAFARI_ZONE_OFFICE");
addMap(11, 3, "MAP_FUCHSIA_CITY_GYM");
addMap(11, 4, "MAP_FUCHSIA_CITY_HOUSE1");
addMap(11, 5, "MAP_FUCHSIA_CITY_POKEMON_CENTER_1F");
addMap(11, 6, "MAP_FUCHSIA_CITY_POKEMON_CENTER_2F");
addMap(11, 7, "MAP_FUCHSIA_CITY_WARDENS_HOUSE");
addMap(11, 8, "MAP_FUCHSIA_CITY_HOUSE2");
addMap(11, 9, "MAP_FUCHSIA_CITY_HOUSE3");

// gMapGroup_IndoorCinnabar
addMap(12, 0, "MAP_CINNABAR_ISLAND_GYM");
addMap(12, 1, "MAP_CINNABAR_ISLAND_POKEMON_LAB_ENTRANCE");
addMap(12, 2, "MAP_CINNABAR_ISLAND_POKEMON_LAB_LOUNGE");
addMap(12, 3, "MAP_CINNABAR_ISLAND_POKEMON_LAB_RESEARCH_ROOM");
addMap(12, 4, "MAP_CINNABAR_ISLAND_POKEMON_LAB_EXPERIMENT_ROOM");
addMap(12, 5, "MAP_CINNABAR_ISLAND_POKEMON_CENTER_1F");
addMap(12, 6, "MAP_CINNABAR_ISLAND_POKEMON_CENTER_2F");
addMap(12, 7, "MAP_CINNABAR_ISLAND_MART");

// gMapGroup_IndoorIndigoPlateau
addMap(13, 0, "MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F");
addMap(13, 1, "MAP_INDIGO_PLATEAU_POKEMON_CENTER_2F");

// gMapGroup_IndoorSaffron
addMap(14, 0, "MAP_SAFFRON_CITY_COPYCATS_HOUSE_1F");
addMap(14, 1, "MAP_SAFFRON_CITY_COPYCATS_HOUSE_2F");
addMap(14, 2, "MAP_SAFFRON_CITY_DOJO");
addMap(14, 3, "MAP_SAFFRON_CITY_GYM");
addMap(14, 4, "MAP_SAFFRON_CITY_HOUSE");
addMap(14, 5, "MAP_SAFFRON_CITY_MART");
addMap(14, 6, "MAP_SAFFRON_CITY_POKEMON_CENTER_1F");
addMap(14, 7, "MAP_SAFFRON_CITY_POKEMON_CENTER_2F");
addMap(14, 8, "MAP_SAFFRON_CITY_MR_PSYCHICS_HOUSE");
addMap(14, 9, "MAP_SAFFRON_CITY_POKEMON_TRAINER_FAN_CLUB");

// gMapGroup_IndoorRoute2
addMap(15, 0, "MAP_ROUTE2_VIRIDIAN_FOREST_SOUTH_ENTRANCE");
addMap(15, 1, "MAP_ROUTE2_HOUSE");
addMap(15, 2, "MAP_ROUTE2_EAST_BUILDING");
addMap(15, 3, "MAP_ROUTE2_VIRIDIAN_FOREST_NORTH_ENTRANCE");

// gMapGroup_IndoorRoute4
addMap(16, 0, "MAP_ROUTE4_POKEMON_CENTER_1F");
addMap(16, 1, "MAP_ROUTE4_POKEMON_CENTER_2F");

// gMapGroup_IndoorRoute5
addMap(17, 0, "MAP_ROUTE5_POKEMON_DAY_CARE");
addMap(17, 1, "MAP_ROUTE5_SOUTH_ENTRANCE");

// gMapGroup_IndoorRoute6
addMap(18, 0, "MAP_ROUTE6_NORTH_ENTRANCE");
addMap(18, 1, "MAP_ROUTE6_UNUSED_HOUSE");

// gMapGroup_IndoorRoute7
addMap(19, 0, "MAP_ROUTE7_EAST_ENTRANCE");

// gMapGroup_IndoorRoute8
addMap(20, 0, "MAP_ROUTE8_WEST_ENTRANCE");

// gMapGroup_IndoorRoute10
addMap(21, 0, "MAP_ROUTE10_POKEMON_CENTER_1F");
addMap(21, 1, "MAP_ROUTE10_POKEMON_CENTER_2F");

// gMapGroup_IndoorRoute11
addMap(22, 0, "MAP_ROUTE11_EAST_ENTRANCE_1F");
addMap(22, 1, "MAP_ROUTE11_EAST_ENTRANCE_2F");

// gMapGroup_IndoorRoute12
addMap(23, 0, "MAP_ROUTE12_NORTH_ENTRANCE_1F");
addMap(23, 1, "MAP_ROUTE12_NORTH_ENTRANCE_2F");
addMap(23, 2, "MAP_ROUTE12_FISHING_HOUSE");

// gMapGroup_IndoorRoute15
addMap(24, 0, "MAP_ROUTE15_WEST_ENTRANCE_1F");
addMap(24, 1, "MAP_ROUTE15_WEST_ENTRANCE_2F");

// gMapGroup_IndoorRoute16
addMap(25, 0, "MAP_ROUTE16_HOUSE");
addMap(25, 1, "MAP_ROUTE16_NORTH_ENTRANCE_1F");
addMap(25, 2, "MAP_ROUTE16_NORTH_ENTRANCE_2F");

// gMapGroup_IndoorRoute18
addMap(26, 0, "MAP_ROUTE18_EAST_ENTRANCE_1F");
addMap(26, 1, "MAP_ROUTE18_EAST_ENTRANCE_2F");

// gMapGroup_IndoorRoute19
addMap(27, 0, "MAP_ROUTE19_UNUSED_HOUSE");

// gMapGroup_IndoorRoute22
addMap(28, 0, "MAP_ROUTE22_NORTH_ENTRANCE");

// gMapGroup_IndoorRoute23
addMap(29, 0, "MAP_ROUTE23_UNUSED_HOUSE");

// gMapGroup_IndoorRoute25
addMap(30, 0, "MAP_ROUTE25_SEA_COTTAGE");

// gMapGroup_IndoorSevenIsland
addMap(31, 0, "MAP_SEVEN_ISLAND_HOUSE_ROOM1");
addMap(31, 1, "MAP_SEVEN_ISLAND_HOUSE_ROOM2");
addMap(31, 2, "MAP_SEVEN_ISLAND_MART");
addMap(31, 3, "MAP_SEVEN_ISLAND_POKEMON_CENTER_1F");
addMap(31, 4, "MAP_SEVEN_ISLAND_POKEMON_CENTER_2F");
addMap(31, 5, "MAP_SEVEN_ISLAND_UNUSED_HOUSE");
addMap(31, 6, "MAP_SEVEN_ISLAND_HARBOR");

// gMapGroup_IndoorOneIsland
addMap(32, 0, "MAP_ONE_ISLAND_POKEMON_CENTER_1F");
addMap(32, 1, "MAP_ONE_ISLAND_POKEMON_CENTER_2F");
addMap(32, 2, "MAP_ONE_ISLAND_HOUSE1");
addMap(32, 3, "MAP_ONE_ISLAND_HOUSE2");
addMap(32, 4, "MAP_ONE_ISLAND_HARBOR");

// gMapGroup_IndoorTwoIsland
addMap(33, 0, "MAP_TWO_ISLAND_JOYFUL_GAME_CORNER");
addMap(33, 1, "MAP_TWO_ISLAND_HOUSE");
addMap(33, 2, "MAP_TWO_ISLAND_POKEMON_CENTER_1F");
addMap(33, 3, "MAP_TWO_ISLAND_POKEMON_CENTER_2F");
addMap(33, 4, "MAP_TWO_ISLAND_HARBOR");

// gMapGroup_IndoorThreeIsland
addMap(34, 0, "MAP_THREE_ISLAND_HOUSE1");
addMap(34, 1, "MAP_THREE_ISLAND_POKEMON_CENTER_1F");
addMap(34, 2, "MAP_THREE_ISLAND_POKEMON_CENTER_2F");
addMap(34, 3, "MAP_THREE_ISLAND_MART");
addMap(34, 4, "MAP_THREE_ISLAND_HOUSE2");
addMap(34, 5, "MAP_THREE_ISLAND_HOUSE3");
addMap(34, 6, "MAP_THREE_ISLAND_HOUSE4");
addMap(34, 7, "MAP_THREE_ISLAND_HOUSE5");

// gMapGroup_IndoorFourIsland
addMap(35, 0, "MAP_FOUR_ISLAND_POKEMON_DAY_CARE");
addMap(35, 1, "MAP_FOUR_ISLAND_POKEMON_CENTER_1F");
addMap(35, 2, "MAP_FOUR_ISLAND_POKEMON_CENTER_2F");
addMap(35, 3, "MAP_FOUR_ISLAND_HOUSE1");
addMap(35, 4, "MAP_FOUR_ISLAND_LORELEIS_HOUSE");
addMap(35, 5, "MAP_FOUR_ISLAND_HARBOR");
addMap(35, 6, "MAP_FOUR_ISLAND_HOUSE2");
addMap(35, 7, "MAP_FOUR_ISLAND_MART");

// gMapGroup_IndoorFiveIsland
addMap(36, 0, "MAP_FIVE_ISLAND_POKEMON_CENTER_1F");
addMap(36, 1, "MAP_FIVE_ISLAND_POKEMON_CENTER_2F");
addMap(36, 2, "MAP_FIVE_ISLAND_HARBOR");
addMap(36, 3, "MAP_FIVE_ISLAND_HOUSE1");
addMap(36, 4, "MAP_FIVE_ISLAND_HOUSE2");

// gMapGroup_IndoorSixIsland
addMap(37, 0, "MAP_SIX_ISLAND_POKEMON_CENTER_1F");
addMap(37, 1, "MAP_SIX_ISLAND_POKEMON_CENTER_2F");
addMap(37, 2, "MAP_SIX_ISLAND_HARBOR");
addMap(37, 3, "MAP_SIX_ISLAND_HOUSE");
addMap(37, 4, "MAP_SIX_ISLAND_MART");

// gMapGroup_IndoorThreeIslandRoute
addMap(38, 0, "MAP_THREE_ISLAND_HARBOR");

// gMapGroup_IndoorFiveIslandRoute
addMap(39, 0, "MAP_FIVE_ISLAND_RESORT_GORGEOUS_HOUSE");

// gMapGroup_IndoorTwoIslandRoute
addMap(40, 0, "MAP_TWO_ISLAND_CAPE_BRINK_HOUSE");

// gMapGroup_IndoorSixIslandRoute
addMap(41, 0, "MAP_SIX_ISLAND_WATER_PATH_HOUSE1");
addMap(41, 1, "MAP_SIX_ISLAND_WATER_PATH_HOUSE2");

// gMapGroup_IndoorSevenIslandRoute
addMap(42, 0, "MAP_SEVEN_ISLAND_SEVAULT_CANYON_HOUSE");

// Special map numbers
addMap(0x7F, 0x7F, "MAP_DYNAMIC");
addMap(0xFF, 0xFF, "MAP_UNDEFINED");

/**
 * Gets the map name from the group and map number.
 * @param {number} groupNum - The map group number.
 * @param {number} mapNum - The map number within the group.
 * @returns {string | undefined} - The map name string, or undefined if not found.
 */
export function getMapName(groupNum, mapNum) {
  return mapLookup.get(groupNum)?.get(mapNum);
}