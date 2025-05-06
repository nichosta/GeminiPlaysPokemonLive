// Node.js module to send a GBA button tap command via HTTP POST.
// Requires Node.js v18+ for the fetch API.

// Target URL for the mGBA HTTP control endpoint.
const TARGET_URL = 'http://localhost:5000/mgba-http/button/tap';

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
 * Sends a button tap command to the mGBA HTTP endpoint.
 * Accepts button names case-insensitively.
 *
 * @param {string} buttonName - The name of the GBA button (e.g., 'A', 'a', 'Start', 'start').
 * @returns {Promise<void>} A promise that resolves if the command is sent successfully,
 * and rejects if there's an error (invalid button, network issue, server error).
 * @throws {Error} If the button name is invalid.
 */
async function sendButtonTap(buttonName) {
  if (typeof buttonName !== 'string' || !buttonName) {
    throw new Error('Invalid input: Button name must be a non-empty string.');
  }

  const lowerCaseButton = buttonName.toLowerCase();

  // Validate and get the correct casing for the API call.
  if (!VALID_LOWERCASE_BUTTONS.has(lowerCaseButton)) {
    const validButtonsList = Object.values(API_BUTTON_CASING).join(', ');
    throw new Error(`Invalid button name "${buttonName}". Valid buttons are: ${validButtonsList}`);
  }

  // Get the correctly cased button name for the API.
  const buttonToSend = API_BUTTON_CASING[lowerCaseButton];

  // console.log(`Sending button tap: ${buttonToSend} to ${TARGET_URL}`);

  try {
    // Send the POST request with the button name as a query parameter.
    const response = await fetch(`${TARGET_URL}?key=${encodeURIComponent(buttonToSend)}`, {
      method: 'POST',
      // No body or Content-Type needed if sending via query parameter
    });

    // Check if the request was successful (HTTP status 2xx).
    if (response.ok) {
      // console.log(`Successfully sent "${buttonToSend}" tap command. Status: ${response.status}`);
      // The promise resolves successfully here.
      return; // Indicate success
    } else {
      // Handle HTTP errors (e.g., 404 Not Found, 400 Bad Request, 500 Internal Server Error).
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch (e) {
        // Ignore error reading body if it fails
      }
      const errorMessage = `Error sending command. Server responded with status: ${response.status} ${response.statusText}. ${errorBody ? 'Response: ' + errorBody : ''}`;
      console.error(errorMessage);
      // Reject the promise with an error object.
      throw new Error(errorMessage);
    }
  } catch (error) {
    // Handle network errors or errors thrown from the response check.
    console.error('Network or fetch error:', error.message);
    if (error.cause && error.cause.code === 'ECONNREFUSED') {
      console.error(`Connection refused. Is mGBA running and the HTTP server enabled at ${TARGET_URL}?`);
    }
    // Re-throw the error to reject the promise.
    throw error;
  }
}

/**
 * Sends a sequence of button presses to the mGBA HTTP endpoint.
 * Accepts a single button name or an array of button names.
 *
 * @param {string|string[]} buttons - The name of the GBA button or an array of button names (e.g., 'A', 'a', 'Start', 'start', ['Up', 'A']).
 * @returns {Promise<void>} A promise that resolves if the command is sent successfully,
 * and rejects if there's an error (invalid button, network issue, server error).
 * @throws {Error} If the button name is invalid.
 */
export async function pressButtons(buttons) {
  if (Array.isArray(buttons)) {
    for (const button of buttons) {
      await sendButtonTap(button);
      await delay(500);
    }
  } else {
    await sendButtonTap(buttons);
  }
}

/**
 * @description Delays execution for a specified number of milliseconds.
 * @param {number} ms Time to delay in milliseconds.
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}