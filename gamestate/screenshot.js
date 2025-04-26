import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp'; // Import the sharp library

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @description Gets the current game screenshot, upscales it by 2x, and returns it as a base64 encoded string.
 * Ensure the string includes the data URI prefix (e.g., "data:image/png;base64,").
 * @returns {Promise<string | null>} Base64 encoded upscaled image string with prefix, or null on error.
 */
export async function getGameImageBase64() {
  try {
    const screenshotPath = path.join(__dirname, '..', 'screenshots', 'screenshot.png');
    
    // 1. Fetch the original screenshot
    await fetch(`http://localhost:5000/core/screenshot?path=${screenshotPath}`, { method: 'POST' });

    // 2. Check if the screenshot file exists
    if (!fs.existsSync(screenshotPath)) {
        console.error('Error: Screenshot file not found after fetch:', screenshotPath);
        return null;
    }

    // 3. Upscale the image using sharp
    const image = sharp(screenshotPath);
    const metadata = await image.metadata(); // Get original dimensions
    const newWidth = metadata.width * 3;
    const newHeight = metadata.height * 3;

    // Resize (upscale) and save temporarily (or process directly to buffer)
    // Using toBuffer is generally more efficient than writing/reading a temp file
    const upscaledBuffer = await image
        .resize(newWidth, newHeight, {
            kernel: sharp.kernel.nearest // Use 'nearest' for pixel art style upscaling
            // Other options: 'lanczos3', 'mitchell', etc. for smoother results
        })
        .toBuffer();

    // 4. Encode the upscaled buffer to base64
    const base64 = upscaledBuffer.toString('base64');

    // 5. Clean up the original screenshot file (optional, depends on your workflow)
    // fs.unlinkSync(screenshotPath);

    // 6. Return the data URI
    return `data:image/png;base64,${base64}`;

  } catch (error) {
    console.error('Error getting or upscaling screenshot:', error);
    // Check if the error is from fetch or sharp specifically if needed
    // e.g., if (error instanceof fetch.FetchError) { ... }
    return null;
  }
}

/**
 * @description Parses a data URI (like base64 image string) into mime type and raw data.
 * @param {string} dataURI The data URI string (e.g., "data:image/png;base64,iVBOR...")
 * @returns {{ mimeType: string, data: string } | null} Object with mimeType and data, or null if parsing fails.
 */
export function parseDataURI(dataURI) {
    // Added a check for null or undefined input
    if (!dataURI) {
        console.error("Error: Invalid data URI received (null or undefined).");
        return null;
    }
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
