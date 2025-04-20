import fs from 'fs/promises'; // Use the promises API for async/await
import path from 'path';      // For resolving file paths robustly

/**
 * Reads the content of a text file, returns the content, and then clears the file.
 *
 * @param {string} relativeFilePath - The path to the text file, relative to the project root or current working directory.
 * @returns {Promise<string|null>} The content of the file as a string, or null if an error occurred (e.g., file not found).
 */
export async function readAndClearFile(relativeFilePath) {
    // Resolve the relative path to an absolute path for reliability
    const absoluteFilePath = path.resolve(relativeFilePath);

    let fileContent = null;

    try {
        // 1. Read the file content
        fileContent = await fs.readFile(absoluteFilePath, 'utf8');

        // 2. Clear the file content (overwrite with an empty string)
        await fs.writeFile(absoluteFilePath, '', 'utf8');

        // 3. Return the original content
        return fileContent;

    } catch (error) {
        if (error.code === 'ENOENT') {
            // File not found is a common case, handle it gracefully
            console.warn(`Warning: File not found at ${absoluteFilePath}. Cannot read or clear.`);
        } else {
            // Log other potential errors (permissions, etc.)
            console.error(`Error processing file ${absoluteFilePath}:`, error);
        }
        // Return null to indicate failure
        return null;
    }
}