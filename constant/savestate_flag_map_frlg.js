const flagMap = new Map([
    ["FLAG_BADGE01_GET", 0x820],
    ["FLAG_BADGE02_GET", 0x821],
    ["FLAG_BADGE03_GET", 0x822],
    ["FLAG_BADGE04_GET", 0x823],
    ["FLAG_BADGE05_GET", 0x824],
    ["FLAG_BADGE06_GET", 0x825],
    ["FLAG_BADGE07_GET", 0x826],
    ["FLAG_BADGE08_GET", 0x827],
]);

/**
 * @description Definitions for FRLG badges, mapping display names to flag constants.
 * @type {Array<{name: string, flagConstant: string}>}
 */
export const BADGE_DEFINITIONS = [
    { name: "Boulder Badge", flagConstant: "FLAG_BADGE01_GET" },
    { name: "Cascade Badge", flagConstant: "FLAG_BADGE02_GET" },
    { name: "Thunder Badge", flagConstant: "FLAG_BADGE03_GET" },
    { name: "Rainbow Badge", flagConstant: "FLAG_BADGE04_GET" },
    { name: "Soul Badge", flagConstant: "FLAG_BADGE05_GET" },
    { name: "Marsh Badge", flagConstant: "FLAG_BADGE06_GET" },
    { name: "Volcano Badge", flagConstant: "FLAG_BADGE07_GET" },
    { name: "Earth Badge", flagConstant: "FLAG_BADGE08_GET" },
];

// Gets the flag address from the flag name
/**
 * @description Gets the flag address from the flag name.
 * @param {string} flagName - The flag name.
 * @returns {number | undefined} The flag address or undefined if not found.
 */
export function getFlagAddress(flagName) {
    return flagMap.get(flagName);
}