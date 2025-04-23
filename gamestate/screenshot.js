import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @description Gets the current game screenshot as a base64 encoded string.
 * Ensure the string includes the data URI prefix (e.g., "data:image/jpeg;base64," or "data:image/png;base64,").
 * @returns {Promise<string>} Base64 encoded image string with prefix.
 */
export async function getGameImageBase64() {
  try {
    const screenshotPath = path.join(__dirname, 'screenshots', 'screenshot.png');
    await fetch(`http://localhost:5000/core/screenshot?path=${screenshotPath}`, { method: 'POST' });
    const base64 = fs.readFileSync(screenshotPath, { encoding: 'base64' });
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error('Error getting screenshot:', error);
    return null;
  }
}

/**
 * @description Parses a data URI (like base64 image string) into mime type and raw data.
 * @param {string} dataURI The data URI string (e.g., "data:image/png;base64,iVBOR...")
 * @returns {{ mimeType: string, data: string } | null} Object with mimeType and data, or null if parsing fails.
 */
export function parseDataURI(dataURI) {
    const match = dataURI.match(/^data:(.+);base64,(.*)$/);
    if (match && match.length === 3) {
        return {
            mimeType: match[1], // e.g., "image/png"
            data: match[2]      // The actual base64 data
        };
    }
    console.error("Error: Invalid data URI format received.");
    return null;
}