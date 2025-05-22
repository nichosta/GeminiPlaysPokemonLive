// Node.js module to send GBA button hold commands via HTTP POST.
// Requires Node.js v18+ for the fetch API.

// Target URL for the mGBA HTTP control endpoint for holding buttons.
const TARGET_URL_HOLD = 'http://localhost:5000/mgba-http/button/hold';

// Define the exact button names expected by the mGBA API.
const API_BUTTON_CASING = {
  a: 'A',
  b: 'B',
  l: 'L',
  r: 'R',
  start: 'Start',
  select: 'Select',
  up: 'Up',
  left: 'Left',
  down: 'Down',
  right: 'Right'
};

// Create a set of valid lowercase button names for quick lookup.
const VALID_LOWERCASE_BUTTONS = new Set(Object.keys(API_BUTTON_CASING));

/**
 * @description Delays execution for a specified number of milliseconds.
 * @param {number} ms Time to delay in milliseconds.
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sends a button hold command to the mGBA HTTP endpoint.
 *
 * @param {string} buttonName - The name of the GBA button (e.g., 'A', 'a', 'Start').
 * @param {number} durationFrames - The duration to hold the button in frames (game runs at 60 FPS).
 * @returns {Promise<void>} A promise that resolves if the command is sent successfully,
 * and rejects if there's an error.
 * @throws {Error} If the button name or duration is invalid.
 */
async function sendButtonHoldCommand(buttonName, durationFrames) {
  if (typeof buttonName !== 'string' || !buttonName) {
    throw new Error('Invalid input: Button name must be a non-empty string.');
  }
  if (typeof durationFrames !== 'number' || durationFrames <= 0) {
    throw new Error('Invalid input: Duration in frames must be a positive number.');
  }

  const lowerCaseButton = buttonName.toLowerCase();

  if (!VALID_LOWERCASE_BUTTONS.has(lowerCaseButton)) {
    const validButtonsList = Object.values(API_BUTTON_CASING).join(', ');
    throw new Error(`Invalid button name "${buttonName}". Valid buttons are: ${validButtonsList}`);
  }

  const buttonToSend = API_BUTTON_CASING[lowerCaseButton];

  // console.log(`Sending button hold: ${buttonToSend} for ${durationFrames} frames to ${TARGET_URL_HOLD}`);

  try {
    const response = await fetch(`${TARGET_URL_HOLD}?key=${encodeURIComponent(buttonToSend)}&duration=${durationFrames}`, {
      method: 'POST',
    });

    if (response.ok) {
      // console.log(`Successfully sent "${buttonToSend}" hold command for ${durationFrames} frames. Status: ${response.status}`);
      return;
    } else {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch (e) { /* Ignore error reading body */ }
      const errorMessage = `Error sending hold command. Server responded with status: ${response.status} ${response.statusText}. ${errorBody ? 'Response: ' + errorBody : ''}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
  } catch (error) {
    console.error('Network or fetch error during button hold:', error.message);
    if (error.cause && error.cause.code === 'ECONNREFUSED') {
      console.error(`Connection refused. Is mGBA running and the HTTP server enabled at ${TARGET_URL_HOLD}?`);
    }
    throw error;
  }
}

/**
 * Sends a sequence of button hold commands to the mGBA HTTP endpoint.
 * Each button is held for its specified duration, and the next hold command
 * is sent after the previous hold duration has elapsed.
 *
 * @param {Array<{buttonName: string, durationFrames: number}>} buttonsToHoldArray - An array of objects,
 * each specifying a button to hold and the duration in frames.
 * @returns {Promise<void>} A promise that resolves if all commands are sent successfully,
 * and rejects if there's an error.
 * @throws {Error} If the input is invalid or any command fails.
 */
export async function holdButtons(buttonsToHoldArray) {
  if (!Array.isArray(buttonsToHoldArray) || buttonsToHoldArray.some(item => typeof item.buttonName !== 'string' || typeof item.durationFrames !== 'number' || item.durationFrames <= 0)) {
    throw new Error('Invalid input: buttonsToHoldArray must be an array of {buttonName: string, durationFrames: positive number} objects.');
  }

  for (const { buttonName, durationFrames } of buttonsToHoldArray) {
    await sendButtonHoldCommand(buttonName, durationFrames);
    // Wait for the hold duration to elapse before processing the next button.
    // 1 frame = 1000/60 ms.
    const delayMilliseconds = Math.ceil((durationFrames * 1000) / 60);
    await delay(delayMilliseconds);
  }
}