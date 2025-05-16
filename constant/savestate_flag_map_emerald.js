const flagMap = new Map([
    ["FLAG_BADGE01_GET", 0x867],
    ["FLAG_BADGE02_GET", 0x868],
    ["FLAG_BADGE03_GET", 0x869],
    ["FLAG_BADGE04_GET", 0x86A],
    ["FLAG_BADGE05_GET", 0x86B],
    ["FLAG_BADGE06_GET", 0x86C],
    ["FLAG_BADGE07_GET", 0x86D],
    ["FLAG_BADGE08_GET", 0x86E],
]);

/**
 * @description Definitions for Emerald badges, mapping display names to flag constants.
 * @type {Array<{name: string, flagConstant: string}>}
 */
export const BADGE_DEFINITIONS = [
    { name: "Stone Badge", flagConstant: "FLAG_BADGE01_GET" },
    { name: "Knuckle Badge", flagConstant: "FLAG_BADGE02_GET" },
    { name: "Dynamo Badge", flagConstant: "FLAG_BADGE03_GET" },
    { name: "Heat Badge", flagConstant: "FLAG_BADGE04_GET" },
    { name: "Balance Badge", flagConstant: "FLAG_BADGE05_GET" },
    { name: "Feather Badge", flagConstant: "FLAG_BADGE06_GET" },
    { name: "Mind Badge", flagConstant: "FLAG_BADGE07_GET" },
    { name: "Rain Badge", flagConstant: "FLAG_BADGE08_GET" },
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