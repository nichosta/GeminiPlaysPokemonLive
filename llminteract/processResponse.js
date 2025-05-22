// Imports from other files
import { pressButtons } from "../tools/buttonPress.js";
import { stunNPC } from "../tools/stunNPC.js";
import { holdButtons } from "../tools/buttonHold.js";
import { validatePath } from "../gamestate/overworld/mapPathValidator.js";

/**
 * @description Processes the LLM's response, assuming it contains a tool call.
 * If parsing fails, logs the raw text response.
 * @param {object} llmResponse The parsed response object from the LLM.
 * @param {object | null} currentMapState The current visible map state, for path validation.
 * @returns {Promise<{toolExecutionText: string, pathValidationResult: object}>} Object containing tool execution status and path validation result.
 */
export async function processLLMResponse(llmResponse, currentMapState) {
    console.log("--- Processing LLM Response ---");

    let pathValidationOutcome = { isValid: true, reason: "No navigation path proposed or validation not applicable." };
    const responseText = llmResponse?.commentary;
    const navigationPath = llmResponse?.navigation; // Array of {x,y}
    const mistakeText = llmResponse?.mistakes;
    const longTermGoal = llmResponse?.goalLongTerm;
    const midTermGoal = llmResponse?.goalMidTerm;
    const shortTermGoal = llmResponse?.goalShortTerm;
    

    console.log(`LLM Thoughts:\n${responseText ?? "N/A"}`);

    if (navigationPath && navigationPath.length > 0) {
        const navigationDisplayArray = navigationPath.map(item => `[${item.x},${item.y}]`);
        console.log(`LLM Proposed Navigation:\n${navigationDisplayArray.join(" -> ")}`);

        const pathCoordinates = navigationPath.map(coord => [coord.x, coord.y]);
        if (currentMapState) {
            const validationResult = await validatePath(pathCoordinates, currentMapState);
            pathValidationOutcome = validationResult;

            if (!validationResult.isValid) {
                console.warn(`LLM Navigation Path Validation FAILED:`);
                if (validationResult.failurePoint) {
                    console.warn(`  Failure at [${validationResult.failurePoint.join(',')}] because: ${validationResult.reason}`);
                } else {
                    console.warn(`  Reason: ${validationResult.reason}`);
                }
            }
        } else {
            pathValidationOutcome = { isValid: false, reason: "Map state not available for validation." };
            console.warn("Skipping navigation path validation: currentMapState not available.");
        }
    } else {
        console.log("LLM Proposed Navigation: N/A");
    }

    console.log(`LLM Mistakes:\n${mistakeText ?? "N/A"}`);
    console.log(`LLM Long Term Goal:\n${longTermGoal ?? "N/A"}`);
    console.log(`LLM Mid Term Goal:\n${midTermGoal ?? "N/A"}`);
    console.log(`LLM Short Term Goal:\n${shortTermGoal ?? "N/A"}`);

    try {
        if (llmResponse.functionCall == null) {
            console.warn("Warning: No tool call in LLM response.");
            console.log("Full LLM Response (no function call):", JSON.stringify(llmResponse, null, 2));
            return {
                toolExecutionText: "No tool call in this response. You may disregard this message if this was intentional.",
                pathValidationResult: pathValidationOutcome
            };
        }

        const responseFunctionCall = llmResponse.functionCall;

        if (
            responseFunctionCall &&
            typeof responseFunctionCall === "object" &&
            responseFunctionCall.name &&
            typeof responseFunctionCall.name === "string" &&
            responseFunctionCall.args
        ) {
            console.log(`Attempting to execute tool: ${responseFunctionCall.name}`);
            const args = responseFunctionCall.args;

            switch (responseFunctionCall.name) {
                case "pressButtons":
                    if (args.buttons) {
                        await pressButtons(args.buttons);
                        console.log(args);
                        return { toolExecutionText: "Successfully executed 'pressButtons' tool.", pathValidationResult: pathValidationOutcome };
                    } else {
                        console.warn("Tool 'pressButtons' called with invalid args:", args);
                        return { toolExecutionText: "Tool 'pressButtons' called with invalid args.", pathValidationResult: pathValidationOutcome };
                    }
                case "stunNPC":
                    if (args.npcID) {
                        await stunNPC(args.npcID);
                        console.log(args);
                        return { toolExecutionText: "Successfully executed 'stunNPC' tool.", pathValidationResult: pathValidationOutcome };
                    } else {
                        console.warn("Tool 'stunNPC' called with invalid args:", args);
                        return { toolExecutionText: "Tool 'stunNPC' called with invalid args.", pathValidationResult: pathValidationOutcome };
                    }
                case "holdButtons":
                    if (args.buttonsToHold && Array.isArray(args.buttonsToHold) && args.buttonsToHold.every(item => typeof item.buttonName === 'string' && typeof item.durationFrames === 'number' && item.durationFrames > 0)) {
                        await holdButtons(args.buttonsToHold);
                        console.log(args);
                        return { toolExecutionText: "Successfully executed 'holdButtons' tool.", pathValidationResult: pathValidationOutcome };
                    } else {
                        console.warn("Tool 'holdButtons' called with invalid args:", args);
                        return { toolExecutionText: "Tool 'holdButtons' called with invalid args. Expected { buttonsToHold: [{ buttonName: string, durationFrames: number (positive integer) }] }.", pathValidationResult: pathValidationOutcome };
                    }
                default:
                    console.warn(`Received unknown tool name: ${responseFunctionCall.name}`);
                    return { toolExecutionText: `Unknown tool name: ${responseFunctionCall.name}`, pathValidationResult: pathValidationOutcome };
            }
        } else {
            console.log("LLM response functionCall is invalid or missing expected structure. Outputting object:", responseFunctionCall);
            console.log("Original LLM Response Object:", llmResponse); // Log the original llmResponse for context
            return { toolExecutionText: "Improper tool call format.", pathValidationResult: pathValidationOutcome };
        }
    } catch (error) {
        console.error("Error processing LLM response:", error);
        console.error("Original LLM Response that caused error:", JSON.stringify(llmResponse, null, 2)); // Log the response that caused error
        return { toolExecutionText: "Unspecified error processing LLM response.", pathValidationResult: pathValidationOutcome };
    }
}