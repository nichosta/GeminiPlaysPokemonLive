import * as CONFIGS from "../CONFIGS.js";

/**
 * @description Sends the current screenshot to Cerebras and returns a text description of it,
 * so the main OpenRouter model can receive text-only context instead of a raw image.
 * @param {import("openai").OpenAI} cerebrasClient An OpenAI-SDK client configured for the Cerebras API.
 * @param {{ mimeType: string, data: string }} imageParts Parsed data URI parts of the screenshot.
 * @returns {Promise<string|null>} The description text, or null on failure.
 */
export async function describeScreenshot(cerebrasClient, imageParts) {
    if (!imageParts || !imageParts.data) {
        console.error("describeScreenshot: missing image data.");
        return null;
    }

    try {
        const result = await cerebrasClient.chat.completions.create({
            model: CONFIGS.CEREBRAS_MODEL_NAME,
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: CONFIGS.SYSTEM_PROMPT_CEREBRAS_VISION },
                        {
                            type: "image_url",
                            image_url: { url: `data:${imageParts.mimeType};base64,${imageParts.data}` },
                        },
                    ],
                },
            ],
        });

        const description = result.choices?.[0]?.message?.content;
        if (!description) {
            console.error("describeScreenshot: no content in Cerebras response.", result);
            return null;
        }
        return description;
    } catch (error) {
        console.error("describeScreenshot: error calling Cerebras API:", error);
        return null;
    }
}
