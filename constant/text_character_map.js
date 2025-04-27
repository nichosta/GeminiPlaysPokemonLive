// This is technically less efficient than just converting this into a map constant but it's a lot more readable this way
// This is directly from pokefirered\include\characters.h (slightly edited)
const TEXT_CHARACTER_ENCODINGS = `
#define CHAR_SPACE             0x00
#define CHAR_A_GRAVE           0x01 // À
#define CHAR_A_ACUTE           0x02 // Á
#define CHAR_A_CIRCUMFLEX      0x03 // Â
#define CHAR_C_CEDILLA         0x04 // Ç
#define CHAR_E_GRAVE           0x05 // È
#define CHAR_E_ACUTE           0x06 // É
#define CHAR_E_CIRCUMFLEX      0x07 // Ê
#define CHAR_E_DIAERESIS       0x08 // Ë
#define CHAR_I_GRAVE           0x09 // Ì
#define CHAR_I_CIRCUMFLEX      0x0B // Î
#define CHAR_I_DIAERESIS       0x0C // Ï
#define CHAR_O_GRAVE           0x0D // Ò
#define CHAR_O_ACUTE           0x0E // Ó
#define CHAR_O_CIRCUMFLEX      0x0F // Ô
#define CHAR_OE                0x10 // Œ
#define CHAR_U_GRAVE           0x11 // Ù
#define CHAR_U_ACUTE           0x12 // Ú
#define CHAR_U_CIRCUMFLEX      0x13 // Û
#define CHAR_N_TILDE           0x14 // Ñ
#define CHAR_ESZETT            0x15 // ß
#define CHAR_a_GRAVE           0x16 // à
#define CHAR_a_ACUTE           0x17 // á
#define CHAR_c_CEDILLA         0x19 // ç
#define CHAR_e_GRAVE           0x1A // è
#define CHAR_e_ACUTE           0x1B // é
#define CHAR_e_CIRCUMFLEX      0x1C // ê
#define CHAR_e_DIAERESIS       0x1D // ë
#define CHAR_i_GRAVE           0x1E // ì
#define CHAR_i_CIRCUMFLEX      0x20 // î
#define CHAR_i_DIAERESIS       0x21 // ï
#define CHAR_o_GRAVE           0x22 // ò
#define CHAR_o_ACUTE           0x23 // ó
#define CHAR_o_CIRCUMFLEX      0x24 // ô
#define CHAR_oe                0x25 // œ
#define CHAR_u_GRAVE           0x26 // ù
#define CHAR_u_ACUTE           0x27 // ú
#define CHAR_u_CIRCUMFLEX      0x28 // û
#define CHAR_n_TILDE           0x29 // ñ
#define CHAR_MASCULINE_ORDINAL 0x2A // º
#define CHAR_FEMININE_ORDINAL  0x2B // ª
#define CHAR_SUPER_ER          0x2C // <0x2C> TODO: Find representation
#define CHAR_AMPERSAND         0x2D // &
#define CHAR_PLUS              0x2E // +
//
#define CHAR_LV                0x34 // Lv
#define CHAR_EQUALS            0x35 // =
#define CHAR_SEMICOLON         0x36 // ;
#define CHAR_BARD_WORD_DELIMIT 0x37 // <0x37> TODO: Find representation
//
#define CHAR_EMPTY_RECT        0x50 // <0x50> TODO: Find representation
#define CHAR_INV_QUESTION_MARK 0x51 // ¿
#define CHAR_INV_EXCL_MARK     0x52 // ¡
#define CHAR_PK                0x53 // PK
#define CHAR_MN                0x54 // MN
#define CHAR_PO                0x55 // PO
#define CHAR_KE                0x56 // Ké
#define CHAR_BLOCK_1           0x57 // <0x57> TODO: Find representation
#define CHAR_BLOCK_2           0x58 // <0x58> TODO: Find representation
#define CHAR_BLOCK_3           0x59 // <0x59> TODO: Find representation
#define CHAR_I_ACUTE           0x5A // Í
#define CHAR_PERCENT           0x5B // %
#define CHAR_LEFT_PAREN        0x5C // (
#define CHAR_RIGHT_PAREN       0x5D // )
//
#define CHAR_a_CIRCUMFLEX      0x68 // â
//
#define CHAR_i_ACUTE           0x6F // í
//
#define CHAR_SPACER            0x77 // <0x77> TODO: Find representation
//
#define CHAR_UP_ARROW          0x79 // ↑
#define CHAR_DOWN_ARROW        0x7A // ↓
#define CHAR_LEFT_ARROW        0x7B // ←
#define CHAR_RIGHT_ARROW       0x7C // →
//
#define CHAR_SUPER_E           0x84 // <0x84> TODO: Find representation
#define CHAR_LESS_THAN         0x85 // <
#define CHAR_GREATER_THAN      0x86 // >
//
#define CHAR_SUPER_RE          0xA0 // <0xA0> TODO: Find representation
#define CHAR_0                 0xA1 // 0
#define CHAR_1                 0xA2 // 1
#define CHAR_2                 0xA3 // 2
#define CHAR_3                 0xA4 // 3
#define CHAR_4                 0xA5 // 4
#define CHAR_5                 0xA6 // 5
#define CHAR_6                 0xA7 // 6
#define CHAR_7                 0xA8 // 7
#define CHAR_8                 0xA9 // 8
#define CHAR_9                 0xAA // 9
#define CHAR_EXCL_MARK         0xAB // !
#define CHAR_QUESTION_MARK     0xAC // ?
#define CHAR_PERIOD            0xAD // .
#define CHAR_HYPHEN            0xAE // -
#define CHAR_BULLET            0xAF // · (or *)
#define CHAR_ELLIPSIS          0xB0 // …
#define CHAR_DBL_QUOTE_LEFT    0xB1 // “
#define CHAR_DBL_QUOTE_RIGHT   0xB2 // ”
#define CHAR_SGL_QUOTE_LEFT    0xB3 // ‘
#define CHAR_SGL_QUOTE_RIGHT   0xB4 // ’
#define CHAR_MALE              0xB5 // ♂
#define CHAR_FEMALE            0xB6 // ♀
#define CHAR_CURRENCY          0xB7 // $ (Pokédollar symbol)
#define CHAR_COMMA             0xB8 // ,
#define CHAR_MULT_SIGN         0xB9 // ×
#define CHAR_SLASH             0xBA // /
#define CHAR_A                 0xBB // A
#define CHAR_B                 0xBC // B
#define CHAR_C                 0xBD // C
#define CHAR_D                 0xBE // D
#define CHAR_E                 0xBF // E
#define CHAR_F                 0xC0 // F
#define CHAR_G                 0xC1 // G
#define CHAR_H                 0xC2 // H
#define CHAR_I                 0xC3 // I
#define CHAR_J                 0xC4 // J
#define CHAR_K                 0xC5 // K
#define CHAR_L                 0xC6 // L
#define CHAR_M                 0xC7 // M
#define CHAR_N                 0xC8 // N
#define CHAR_O                 0xC9 // O
#define CHAR_P                 0xCA // P
#define CHAR_Q                 0xCB // Q
#define CHAR_R                 0xCC // R
#define CHAR_S                 0xCD // S
#define CHAR_T                 0xCE // T
#define CHAR_U                 0xCF // U
#define CHAR_V                 0xD0 // V
#define CHAR_W                 0xD1 // W
#define CHAR_X                 0xD2 // X
#define CHAR_Y                 0xD3 // Y
#define CHAR_Z                 0xD4 // Z
#define CHAR_a                 0xD5 // a
#define CHAR_b                 0xD6 // b
#define CHAR_c                 0xD7 // c
#define CHAR_d                 0xD8 // d
#define CHAR_e                 0xD9 // e
#define CHAR_f                 0xDA // f
#define CHAR_g                 0xDB // g
#define CHAR_h                 0xDC // h
#define CHAR_i                 0xDD // i
#define CHAR_j                 0xDE // j
#define CHAR_k                 0xDF // k
#define CHAR_l                 0xE0 // l
#define CHAR_m                 0xE1 // m
#define CHAR_n                 0xE2 // n
#define CHAR_o                 0xE3 // o
#define CHAR_p                 0xE4 // p
#define CHAR_q                 0xE5 // q
#define CHAR_r                 0xE6 // r
#define CHAR_s                 0xE7 // s
#define CHAR_t                 0xE8 // t
#define CHAR_u                 0xE9 // u
#define CHAR_v                 0xEA // v
#define CHAR_w                 0xEB // w
#define CHAR_x                 0xEC // x
#define CHAR_y                 0xED // y
#define CHAR_z                 0xEE // z
#define CHAR_BLACK_TRIANGLE    0xEF // ▶
#define CHAR_COLON             0xF0 // :
#define CHAR_A_DIAERESIS       0xF1 // Ä
#define CHAR_O_DIAERESIS       0xF2 // Ö
#define CHAR_U_DIAERESIS       0xF3 // Ü
#define CHAR_a_DIAERESIS       0xF4 // ä
#define CHAR_o_DIAERESIS       0xF5 // ö
#define CHAR_u_DIAERESIS       0xF6 // ü
#define CHAR_DYNAMIC           0xF7 // <0xF7> TODO: Find representation
#define CHAR_KEYPAD_ICON       0xF8 // Special: Followed by icon byte
#define CHAR_EXTRA_SYMBOL      0xF9 // Special: Followed by symbol byte
#define CHAR_PROMPT_SCROLL     0xFA // Special: Waits for button press and scrolls dialog
#define CHAR_PROMPT_CLEAR      0xFB // Special: Waits for button press and clears dialog
#define EXT_CTRL_CODE_BEGIN    0xFC // Special: Extended control code
#define PLACEHOLDER_BEGIN      0xFD // Special: String placeholder
#define CHAR_NEWLINE           0xFE // \n
#define EOS                    0xFF // Special: End of string

// --- NOTE: Definitions below this line are not directly parsed into the map ---
// --- They are used by the decoder for multi-byte sequences ---

// CHAR_KEYPAD_ICON chars
#define CHAR_A_BUTTON       0x00
#define CHAR_B_BUTTON       0x01
#define CHAR_L_BUTTON       0x02
#define CHAR_R_BUTTON       0x03
#define CHAR_START_BUTTON   0x04
#define CHAR_SELECT_BUTTON  0x05
#define CHAR_DPAD_UP        0x06
#define CHAR_DPAD_DOWN      0x07
#define CHAR_DPAD_LEFT      0x08
#define CHAR_DPAD_RIGHT     0x09
#define CHAR_DPAD_UPDOWN    0x0A
#define CHAR_DPAD_LEFTRIGHT 0x0B
#define CHAR_DPAD_NONE      0x0C

// CHAR_EXTRA_SYMBOL chars
#define CHAR_UP_ARROW_2        0x00
#define CHAR_DOWN_ARROW_2      0x01
#define CHAR_LEFT_ARROW_2      0x02
#define CHAR_RIGHT_ARROW_2     0x03
#define CHAR_PLUS_2            0x04
#define CHAR_LV_2              0x05
#define CHAR_PP                0x06
#define CHAR_ID                0x07
#define CHAR_NO                0x08
#define CHAR_UNDERSCORE        0x09
#define CHAR_CIRCLED_1         0x0A
#define CHAR_CIRCLED_2         0x0B
#define CHAR_CIRCLED_3         0x0C
#define CHAR_CIRCLED_4         0x0D
#define CHAR_CIRCLED_5         0x0E
#define CHAR_CIRCLED_6         0x0F
#define CHAR_CIRCLED_7         0x10
#define CHAR_CIRCLED_8         0x11
#define CHAR_CIRCLED_9         0x12
#define CHAR_LEFT_PAREN_SMALL  0x13
#define CHAR_RIGHT_PAREN_SMALL 0x14
#define CHAR_BULLSEYE          0x15
#define CHAR_TRIANGLE          0x16
#define CHAR_CROSS_X           0x17

#define EXT_CTRL_CODE_COLOR                  0x01
#define EXT_CTRL_CODE_HIGHLIGHT              0x02
#define EXT_CTRL_CODE_SHADOW                 0x03
#define EXT_CTRL_CODE_COLOR_HIGHLIGHT_SHADOW 0x04
#define EXT_CTRL_CODE_PALETTE                0x05
#define EXT_CTRL_CODE_FONT                   0x06
#define EXT_CTRL_CODE_RESET_FONT             0x07
#define EXT_CTRL_CODE_PAUSE                  0x08
#define EXT_CTRL_CODE_PAUSE_UNTIL_PRESS      0x09
#define EXT_CTRL_CODE_WAIT_SE                0x0A
#define EXT_CTRL_CODE_PLAY_BGM               0x0B
#define EXT_CTRL_CODE_ESCAPE                 0x0C
#define EXT_CTRL_CODE_SHIFT_RIGHT            0x0D
#define EXT_CTRL_CODE_SHIFT_DOWN             0x0E
#define EXT_CTRL_CODE_FILL_WINDOW            0x0F
#define EXT_CTRL_CODE_PLAY_SE                0x10
#define EXT_CTRL_CODE_CLEAR                  0x11
#define EXT_CTRL_CODE_SKIP                   0x12
#define EXT_CTRL_CODE_CLEAR_TO               0x13
#define EXT_CTRL_CODE_MIN_LETTER_SPACING     0x14
#define EXT_CTRL_CODE_JPN                    0x15
#define EXT_CTRL_CODE_ENG                    0x16
#define EXT_CTRL_CODE_PAUSE_MUSIC            0x17
#define EXT_CTRL_CODE_RESUME_MUSIC           0x18

#define TEXT_COLOR_TRANSPARENT  0x0
#define TEXT_COLOR_WHITE        0x1
#define TEXT_COLOR_DARK_GRAY    0x2
#define TEXT_COLOR_LIGHT_GRAY   0x3
#define TEXT_COLOR_RED          0x4
#define TEXT_COLOR_LIGHT_RED    0x5
#define TEXT_COLOR_GREEN        0x6
#define TEXT_COLOR_LIGHT_GREEN  0x7
#define TEXT_COLOR_BLUE         0x8
#define TEXT_COLOR_LIGHT_BLUE   0x9
#define TEXT_DYNAMIC_COLOR_1    0xA // Usually white
#define TEXT_DYNAMIC_COLOR_2    0xB // Usually white w/ tinge of green
#define TEXT_DYNAMIC_COLOR_3    0xC // Usually white
#define TEXT_DYNAMIC_COLOR_4    0xD // Usually aquamarine
#define TEXT_DYNAMIC_COLOR_5    0xE // Usually blue-green
#define TEXT_DYNAMIC_COLOR_6    0xF // Usually cerulean

#define PLACEHOLDER_ID_UNKNOWN       0x0
#define PLACEHOLDER_ID_PLAYER        0x1
#define PLACEHOLDER_ID_STRING_VAR_1  0x2
#define PLACEHOLDER_ID_STRING_VAR_2  0x3
#define PLACEHOLDER_ID_STRING_VAR_3  0x4
#define PLACEHOLDER_ID_KUN           0x5
#define PLACEHOLDER_ID_RIVAL         0x6
#define PLACEHOLDER_ID_VERSION       0x7
#define PLACEHOLDER_ID_MAGMA         0x8
#define PLACEHOLDER_ID_AQUA          0x9
#define PLACEHOLDER_ID_MAXIE         0xA
#define PLACEHOLDER_ID_ARCHIE        0xB
#define PLACEHOLDER_ID_GROUDON       0xC
#define PLACEHOLDER_ID_KYOGRE        0xD
`

/**
 * Maps the character name part from the #define to its displayable string representation.
 * @param {string} namePart - The part after "CHAR_" (e.g., "SPACE", "A", "EXCL_MARK").
 * @returns {string} The displayable character or a placeholder string.
 */
function getDisplayCharacter(namePart) {
    // Simple A-Z, a-z, 0-9
    if (namePart.length === 1) {
        if (namePart >= 'A' && namePart <= 'Z') return namePart;
        if (namePart >= 'a' && namePart <= 'z') return namePart;
        if (namePart >= '0' && namePart <= '9') return namePart;
    }

    // Map common names and symbols
    switch (namePart) {
        case 'SPACE': return ' ';
        case 'A_GRAVE': return 'À';
        case 'A_ACUTE': return 'Á';
        case 'A_CIRCUMFLEX': return 'Â';
        case 'C_CEDILLA': return 'Ç';
        case 'E_GRAVE': return 'È';
        case 'E_ACUTE': return 'É';
        case 'E_CIRCUMFLEX': return 'Ê';
        case 'E_DIAERESIS': return 'Ë';
        case 'I_GRAVE': return 'Ì';
        case 'I_ACUTE': return 'Í';
        case 'I_CIRCUMFLEX': return 'Î';
        case 'I_DIAERESIS': return 'Ï';
        case 'O_GRAVE': return 'Ò';
        case 'O_ACUTE': return 'Ó';
        case 'O_CIRCUMFLEX': return 'Ô';
        case 'OE': return 'Œ';
        case 'U_GRAVE': return 'Ù';
        case 'U_ACUTE': return 'Ú';
        case 'U_CIRCUMFLEX': return 'Û';
        case 'N_TILDE': return 'Ñ';
        case 'ESZETT': return 'ß';
        case 'a_GRAVE': return 'à';
        case 'a_ACUTE': return 'á';
        case 'a_CIRCUMFLEX': return 'â';
        case 'c_CEDILLA': return 'ç';
        case 'e_GRAVE': return 'è';
        case 'e_ACUTE': return 'é';
        case 'e_CIRCUMFLEX': return 'ê';
        case 'e_DIAERESIS': return 'ë';
        case 'i_GRAVE': return 'ì';
        case 'i_ACUTE': return 'í';
        case 'i_CIRCUMFLEX': return 'î';
        case 'i_DIAERESIS': return 'ï';
        case 'o_GRAVE': return 'ò';
        case 'o_ACUTE': return 'ó';
        case 'o_CIRCUMFLEX': return 'ô';
        case 'oe': return 'œ';
        case 'u_GRAVE': return 'ù';
        case 'u_ACUTE': return 'ú';
        case 'u_CIRCUMFLEX': return 'û';
        case 'n_TILDE': return 'ñ';
        case 'MASCULINE_ORDINAL': return 'º';
        case 'FEMININE_ORDINAL': return 'ª';
        case 'AMPERSAND': return '&';
        case 'PLUS': return '+';
        case 'LV': return 'Lv';
        case 'EQUALS': return '=';
        case 'SEMICOLON': return ';';
        case 'INV_QUESTION_MARK': return '¿';
        case 'INV_EXCL_MARK': return '¡';
        case 'PK': return 'PK';
        case 'MN': return 'MN';
        case 'PO': return 'PO';
        case 'KE': return 'Ké'; // Assuming Ké based on context
        case 'PERCENT': return '%';
        case 'LEFT_PAREN': return '(';
        case 'RIGHT_PAREN': return ')';
        case 'UP_ARROW': return '↑';
        case 'DOWN_ARROW': return '↓';
        case 'LEFT_ARROW': return '←';
        case 'RIGHT_ARROW': return '→';
        case 'LESS_THAN': return '<';
        case 'GREATER_THAN': return '>';
        case 'EXCL_MARK': return '!';
        case 'QUESTION_MARK': return '?';
        case 'PERIOD': return '.';
        case 'HYPHEN': return '-';
        case 'BULLET': return '·';
        case 'ELLIPSIS': return '…';
        case 'DBL_QUOTE_LEFT': return '“';
        case 'DBL_QUOTE_RIGHT': return '”';
        case 'SGL_QUOTE_LEFT': return '‘';
        case 'SGL_QUOTE_RIGHT': return '’';
        case 'MALE': return '♂';
        case 'FEMALE': return '♀';
        case 'CURRENCY': return '$'; // Using $ for the Pokédollar symbol
        case 'COMMA': return ',';
        case 'MULT_SIGN': return '×';
        case 'SLASH': return '/';
        case 'BLACK_TRIANGLE': return '▶';
        case 'COLON': return ':';
        case 'A_DIAERESIS': return 'Ä';
        case 'O_DIAERESIS': return 'Ö';
        case 'U_DIAERESIS': return 'Ü';
        case 'a_DIAERESIS': return 'ä';
        case 'o_DIAERESIS': return 'ö';
        case 'u_DIAERESIS': return 'ü';

        // --- Special Control/Placeholder Characters ---
        // These are handled directly in the decoder, but we give them representations here too
        case 'NEWLINE': return '\n';
        case 'EOS': return '[EOS]'; // End Of String marker
        case 'PROMPT_SCROLL': return '[SCROLL]';
        case 'PROMPT_CLEAR': return '[CLEAR]';
        case 'EXT_CTRL_CODE_BEGIN': return '[EXT_CTRL]';
        case 'PLACEHOLDER_BEGIN': return '[PLACEHOLDER]';
        case 'KEYPAD_ICON': return '[KEYPAD]';
        case 'EXTRA_SYMBOL': return '[EXTRA]';

        // --- Characters needing specific representation or investigation ---
        case 'SUPER_ER': return '[ER]'; // Placeholder
        case 'BARD_WORD_DELIMIT': return ' '; // Treat as space?
        case 'EMPTY_RECT': return '□'; // Placeholder representation
        case 'BLOCK_1': return '[BLK1]'; // Placeholder
        case 'BLOCK_2': return '[BLK2]'; // Placeholder
        case 'BLOCK_3': return '[BLK3]'; // Placeholder
        case 'SPACER': return ' '; // Treat as space?
        case 'SUPER_E': return '[SUP_E]'; // Placeholder
        case 'SUPER_RE': return '[SUP_RE]'; // Placeholder
        case 'DYNAMIC': return '[DYN]'; // Placeholder

        default:
            // Fallback for unmapped names
            console.warn(`Unmapped character name: CHAR_${namePart}`);
            return `[${namePart}]`;
    }
}


/**
 * Parses C preprocessor character definitions into a JavaScript Map.
 * @param {string} definitionString - The string containing the #define statements.
 * @returns {Map<number, string>} - A Map where keys are character codes (numbers)
 *                                   and values are their displayable string representations.
 */
function parseCharacterDefinitions(definitionString) {
    const map = new Map();
    const lines = definitionString.split('\n');
    // Regex to capture CHAR_NAME and VALUE (hex or decimal)
    const defineRegex = /^#define\s+(?:CHAR_|EOS|EXT_CTRL_CODE_BEGIN|PLACEHOLDER_BEGIN)(\w+)\s+(0x[0-9A-Fa-f]+|\d+)/;

    for (const line of lines) {
        const trimmedLine = line.trim();
        // Only parse lines starting with #define CHAR_, #define EOS, etc.
        if (trimmedLine.startsWith('#define CHAR_') ||
            trimmedLine.startsWith('#define EOS') ||
            trimmedLine.startsWith('#define EXT_CTRL_CODE_BEGIN') ||
            trimmedLine.startsWith('#define PLACEHOLDER_BEGIN'))
        {
            const match = trimmedLine.match(defineRegex);
            if (match) {
                // match[1] is the captured name part (e.g., "SPACE", "A", "EOS")
                // match[2] is the captured value string (e.g., "0x00", "0xBB", "0xFF")
                const namePart = match[1];
                const valueString = match[2];
                let charCode;

                try {
                    charCode = parseInt(valueString); // Handles both decimal and hex (0x...)
                } catch (e) {
                    console.warn(`Could not parse character code from value: ${valueString} in line: ${trimmedLine}`);
                    continue;
                }


                if (!isNaN(charCode)) {
                    const displayChar = getDisplayCharacter(namePart);
                    map.set(charCode, displayChar);
                } else {
                    // This case should ideally not be reached due to the try-catch
                    console.warn(`Parsed NaN character code from value: ${valueString} in line: ${trimmedLine}`);
                }
            }
        }
    }
    return map;
}

// Create the lookup map by parsing the string
const characterMap = parseCharacterDefinitions(TEXT_CHARACTER_ENCODINGS);

// Add explicit mappings for codes that might not have a CHAR_ define or need override
characterMap.set(0xFF, '[EOS]'); // Ensure EOS is mapped, though decoder handles it specially
characterMap.set(0xFE, '\n');    // Ensure Newline is mapped

/**
 * Decodes a byte array representing encoded Pokémon text into a readable string.
 * Handles special control codes and multi-byte sequences.
 *
 * @param {number[]} byteArray - An array of numbers (bytes) representing the encoded text.
 * @returns {string} The decoded, human-readable string.
 */
export function decodeByteArrayToString(byteArray) {
    if (!byteArray || byteArray.length === 0) {
        return "";
    }

    let decodedString = "";
    for (let i = 0; i < byteArray.length; i++) {
        const byte = byteArray[i];

        switch (byte) {
            case 0xFF: // EOS (End Of String)
                return decodedString; // Stop processing

            case 0xFE: // Newline
                decodedString += '\n';
                break;

            case 0xFD: // Placeholder Begin
                i++; // Move to the placeholder ID byte
                if (i < byteArray.length) {
                    const placeholderId = byteArray[i];
                    // You could add more specific names based on PLACEHOLDER_ID defines
                    decodedString += `[VAR ${placeholderId}]`;
                } else {
                    decodedString += '[PLACEHOLDER_ERR]'; // Error: missing ID
                }
                break;

            case 0xFC: // Extended Control Code Begin
                i++; // Move to the control code ID byte
                if (i < byteArray.length) {
                    const extCode = byteArray[i];
                    // TODO: Handle potential parameters for specific extCodes if needed
                    decodedString += `[CTRL ${extCode}]`;
                } else {
                    decodedString += '[EXT_CTRL_ERR]'; // Error: missing code
                }
                break;

            case 0xFA: // Prompt Scroll
                decodedString += '[SCROLL]';
                break;

            case 0xFB: // Prompt Clear
                decodedString += '[CLEAR]';
                break;

            case 0xF8: // Keypad Icon
                i++; // Move to the icon ID byte
                if (i < byteArray.length) {
                    const iconId = byteArray[i];
                    decodedString += `[ICON ${iconId}]`;
                } else {
                    decodedString += '[KEYPAD_ERR]'; // Error: missing ID
                }
                break;

            case 0xF9: // Extra Symbol
                i++; // Move to the symbol ID byte
                if (i < byteArray.length) {
                    const symbolId = byteArray[i];
                    decodedString += `[SYM ${symbolId}]`;
                } else {
                    decodedString += '[EXTRA_ERR]'; // Error: missing ID
                }
                break;

            default:
                // Look up standard characters
                const char = characterMap.get(byte);
                if (char !== undefined) {
                    decodedString += char;
                } else {
                    // Unknown byte, represent it as hex
                    decodedString += `[?${byte.toString(16).toUpperCase().padStart(2, '0')}]`;
                }
                break;
        }
    }

    return decodedString;
}