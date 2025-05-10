import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
// Import player position functions from mapData.js
import { getPlayerX, getPlayerY } from '../overworld/playerData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, '..', '..', 'screenshots');

// --- Grid Configuration ---
const GRID_TILE_WIDTH_PX = 16; // Width of a game tile in pixels on the original screenshot
const GRID_TILE_HEIGHT_PX = 16; // Height of a game tile in pixels on the original screenshot
const GRID_LINE_COLOR = 'rgba(255, 0, 0, 0.5)'; // Semi-transparent red for visibility
// NOTE: Grid line width is now applied directly to the final SVG, but keeping it at 1 is recommended
// for sharpness when combined with crispEdges. The visual thickness comes from scaling.
const GRID_LINE_WIDTH = 1;
const UPSCALE_FACTOR = 3; // The factor by which the image is upscaled
const OUTPUT_FILENAME = 'screenshot_processed.png'; // Name for the saved file with grid/upscaling
const VERTICAL_GRID_SHIFT_PX = -8; // Shift grid UP by 8 pixels (relative to original scale)

/**
 * Generates an SVG string for a grid overlay with offset, optimized for sharp rendering.
 * IMPORTANT: This function now expects dimensions, tile sizes, and offsets corresponding
 *            to the *final* desired output size, not the original image size.
 * @param {number} width The width of the final image.
 * @param {number} height The height of the final image.
 * @param {number} tileWidth The width of each grid cell in the final image.
 * @param {number} tileHeight The height of each grid cell in the final image.
 * @param {string} color The color of the grid lines.
 * @param {number} strokeWidth The width of the grid lines (recommend 1).
 * @param {number} offsetX The horizontal offset for the first grid line in the final image.
 * @param {number} offsetY The vertical offset for the first grid line in the final image.
 * @returns {string} SVG string representing the grid.
 */
function createGridSvg(width, height, tileWidth, tileHeight, color, strokeWidth, offsetX, offsetY) {
    // Ensure offsets wrap correctly within tile dimensions (using final scaled tile dimensions)
    const startX = ((offsetX % tileWidth) + tileWidth) % tileWidth;
    const startY = ((offsetY % tileHeight) + tileHeight) % tileHeight;

    let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<defs><style type="text/css"><![CDATA[line{stroke:${color};stroke-width:${strokeWidth};shape-rendering:crispEdges;}]]></style></defs>`;

    // Vertical lines
    for (let x = startX; x < width; x += tileWidth) {
        svg += `<line x1="${Math.round(x)}" y1="0" x2="${Math.round(x)}" y2="${height}" />`; // Use Math.round for safety with scaled floats
    }
    if (startX !== 0) {
        let firstLineX = startX - tileWidth;
        svg += `<line x1="${Math.round(firstLineX)}" y1="0" x2="${Math.round(firstLineX)}" y2="${height}" />`;
    }

    // Horizontal lines
    for (let y = startY; y < height; y += tileHeight) {
        svg += `<line x1="0" y1="${Math.round(y)}" x2="${width}" y2="${Math.round(y)}" />`; // Use Math.round
    }
    if (startY !== 0) {
        let firstLineY = startY - tileHeight;
        svg += `<line x1="0" y1="${Math.round(firstLineY)}" x2="${width}" y2="${Math.round(firstLineY)}" />`;
    }

    svg += `</svg>`;
    return svg;
}


/**
 * @typedef {Object} GameImages
 * @property {string} original - Base64 encoded original screenshot string with data URI prefix.
 * @property {string} processed - Base64 encoded processed (upscaled, gridded) screenshot string with data URI prefix.
 */

/**
 * @description Gets the current game screenshot (both original and processed versions),
 * fetches player position, upscales the image, draws an aligned grid overlay,
 * saves the processed result, and returns both images as base64 encoded strings.
 * @returns {Promise<GameImages | null>} An object containing base64 encoded original and processed image strings, or null on error.
 */
export async function getGameImagesBase64() {
  try {
    const originalScreenshotPath = path.join(SCREENSHOTS_DIR, 'screenshot.png');
    const processedScreenshotPath = path.join(SCREENSHOTS_DIR, OUTPUT_FILENAME);

    // --- Parallel Fetching (Screenshot & Player Position) ---
    const screenshotResponse = await fetch(`http://localhost:5000/core/screenshot?path=${originalScreenshotPath}`, { method: 'POST' });
    await delay(250);
    const playerX = await getPlayerX();
    const playerY = await getPlayerY();

    if (!screenshotResponse.ok) {
        console.error(`Error fetching screenshot: ${screenshotResponse.status} ${screenshotResponse.statusText}`);
        return null;
    }
    if (!fs.existsSync(originalScreenshotPath)) {
        console.error('Error: Screenshot file not found after fetch:', originalScreenshotPath);
        return null;
    }

    // 1. Read the original image file into a buffer
    const originalBuffer = await fs.promises.readFile(originalScreenshotPath);
    const originalBase64 = originalBuffer.toString('base64'); // Encode original now

    // 2. Load the image from the buffer and get metadata
    const image = sharp(originalBuffer); // Use the buffer directly
    const metadata = await image.metadata();

    // 3. Calculate Upscaled Dimensions
    const newWidth = metadata.width * UPSCALE_FACTOR;
    const newHeight = metadata.height * UPSCALE_FACTOR;

    // 4. Upscale the image *first* using nearest neighbor
    // Note: We start the processing chain from the 'image' instance created in step 2
    const upscaledImageProcessor = image.resize(newWidth, newHeight, {
        kernel: sharp.kernel.nearest
    });

    // --- Calculate Grid Offset (Based on Original Dimensions) ---
    const screenWidthTiles = metadata.width / GRID_TILE_WIDTH_PX;
    const screenHeightTiles = metadata.height / GRID_TILE_HEIGHT_PX;
    const centerTileScreenX = Math.floor(screenWidthTiles / 2);
    const centerTileScreenY = Math.floor(screenHeightTiles / 2);

    const screenTopLeftMapTileX = playerX - centerTileScreenX;
    const screenTopLeftMapTileY = playerY - centerTileScreenY;

    const screenTopLeftMapPixelX = screenTopLeftMapTileX * GRID_TILE_WIDTH_PX;
    const screenTopLeftMapPixelY = screenTopLeftMapTileY * GRID_TILE_HEIGHT_PX;

    let baseOffsetX = (GRID_TILE_WIDTH_PX - (screenTopLeftMapPixelX % GRID_TILE_WIDTH_PX)) % GRID_TILE_WIDTH_PX;
    let baseOffsetY = (GRID_TILE_HEIGHT_PX - (screenTopLeftMapPixelY % GRID_TILE_HEIGHT_PX)) % GRID_TILE_HEIGHT_PX;

    baseOffsetY += VERTICAL_GRID_SHIFT_PX;
    baseOffsetY = ((baseOffsetY % GRID_TILE_HEIGHT_PX) + GRID_TILE_HEIGHT_PX) % GRID_TILE_HEIGHT_PX;
    // --- End Original Offset Calculation ---

    // 5. Scale the calculated offsets and tile sizes for the final grid
    const finalOffsetX = baseOffsetX * UPSCALE_FACTOR;
    const finalOffsetY = baseOffsetY * UPSCALE_FACTOR;
    const finalTileWidth = GRID_TILE_WIDTH_PX * UPSCALE_FACTOR;
    const finalTileHeight = GRID_TILE_HEIGHT_PX * UPSCALE_FACTOR;

    // 6. Create the SVG grid overlay using the *upscaled* dimensions and parameters
    const gridSvg = createGridSvg(
        newWidth, newHeight, finalTileWidth, finalTileHeight,
        GRID_LINE_COLOR, GRID_LINE_WIDTH, finalOffsetX, finalOffsetY
    );
    const gridBuffer = Buffer.from(gridSvg);

    // 7. Composite the grid onto the *upscaled* image
    const finalImageProcessor = upscaledImageProcessor.composite([{
        input: gridBuffer,
        top: 0,
        left: 0,
    }]).flatten();

    // 8. Save the final image and get the processed buffer
    const [saveInfo, processedBuffer] = await Promise.all([
        finalImageProcessor.toFile(processedScreenshotPath),
        finalImageProcessor.toBuffer() // Get the processed buffer
    ]);

    // console.log(`Processed screenshot saved to: ${processedScreenshotPath} (${saveInfo.size} bytes)`);

    // 9. Encode the processed buffer to base64
    const processedBase64 = processedBuffer.toString('base64');

    // 10. Clean up original (optional)
    // fs.unlinkSync(originalScreenshotPath); // Consider if you still want to delete the original file

    // 11. Return both data URIs in an object
    return {
        original: `data:image/png;base64,${originalBase64}`,
        processed: `data:image/png;base64,${processedBase64}`
    };

  } catch (error) {
    console.error('Error getting game images (original and processed):', error);
    return null;
  }
}


/**
 * @description Parses a data URI (like base64 image string) into mime type and raw data.
 * @param {string} dataURI The data URI string (e.g., "data:image/png;base64,iVBOR...")
 * @returns {{ mimeType: string, data: string } | null} Object with mimeType and data, or null if parsing fails.
 */
export function parseDataURI(dataURI) {
    if (!dataURI) {
        console.error("Error: Invalid data URI received (null or undefined).");
        return null;
    }
    const match = dataURI.match(/^data:(.+);base64,(.*)$/);
    if (match && match.length === 3) {
        return {
            mimeType: match[1],
            data: match[2]
        };
    }
    console.error("Error: Invalid data URI format received.");
    return null;
}

/**
 * @description Delays execution for a specified number of milliseconds.
 * @param {number} ms Time to delay in milliseconds.
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }