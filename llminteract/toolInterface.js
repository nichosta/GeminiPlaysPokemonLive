// =============================================================================
// FROZEN TOOL INTERFACE (D1)
// =============================================================================
//
// This module is the SINGLE SOURCE OF TRUTH for the agent's tool interface.
// It is frozen as of TOOL_INTERFACE_VERSION below. Everything in Workstream C
// implements against these schemas, the agent loop (D2) dispatches on them, the
// trace logger (D3) records calls in this shape, and every distillation trace
// (E3) assumes this contract. DO NOT change a tool's name, args, or the outcome
// envelope without bumping TOOL_INTERFACE_VERSION and re-validating any traces
// already collected against the old version.
//
// See docs/tool-interface.md for the prose spec, rationale, and examples.
// =============================================================================

export const TOOL_INTERFACE_VERSION = "1.0.0";

// -----------------------------------------------------------------------------
// Outcome envelope — EVERY tool call resolves to exactly this shape.
// The agent is called again only after a tool returns one of these (event-driven
// loop, D2). D3 logs (state_before, tool_call, outcome) tuples verbatim.
// -----------------------------------------------------------------------------

/** Terminal status of a tool call. */
export const OUTCOME_STATUS = Object.freeze({
    OK: "ok",                         // Tool completed its intent.
    INTERRUPTED: "interrupted",       // A stop condition fired mid-execution (see STOP_REASON).
    FAILED: "failed",                 // Tool could not run / preconditions not met / invalid args.
    BUDGET_EXHAUSTED: "budget_exhausted", // max_steps consumed before intent completed.
});

/**
 * Why a macro stopped. This enum is shared with the B2 interrupt detector — the
 * detector's stop conditions and the tool outcome's stop_reason are the same
 * vocabulary so a trace never has to guess why control returned to the model.
 */
export const STOP_REASON = Object.freeze({
    NONE: "none",                     // Completed normally, no interrupt.
    BATTLE_STARTED: "battle_started",
    DIALOG: "dialog",                 // Controls locked by dialog/cutscene/script.
    CHOICE_REQUIRED: "choice_required", // A yes/no or menu choice needs a decision.
    WARP_COMPLETED: "warp_completed", // Crossed a warp (map changed).
    HP_LOW: "hp_low",                 // A party member dropped below the HP threshold.
    OUT_OF_PP: "out_of_pp",           // Battle policy has no usable move.
    ABOUT_TO_FAINT: "about_to_faint",
    BLOCKED: "blocked",               // Pathing blocked (NPC, impassable, no route).
    UNEXPECTED_MENU: "unexpected_menu",
    UNKNOWN_STATE: "unknown_state",   // Detector could not classify the screen.
    BUDGET_EXHAUSTED: "budget_exhausted",
    INVALID_ARGS: "invalid_args",
    PRECONDITION_FAILED: "precondition_failed",
});

/**
 * Build a well-formed outcome envelope. All tools MUST return this via this
 * helper so the shape stays uniform for D3.
 * @param {string} status one of OUTCOME_STATUS
 * @param {object} [opts]
 * @param {string} [opts.stopReason] one of STOP_REASON (default NONE)
 * @param {number} [opts.stepsUsed] steps consumed against the tool's budget
 * @param {string} [opts.message] short human/model-readable summary
 * @param {object} [opts.stateDelta] compact before→after summary (pos, hp, flags…)
 * @returns {object}
 */
export function makeOutcome(status, opts = {}) {
    return {
        status,
        stop_reason: opts.stopReason ?? STOP_REASON.NONE,
        steps_used: opts.stepsUsed ?? 0,
        message: opts.message ?? "",
        state_delta: opts.stateDelta ?? null,
    };
}

// -----------------------------------------------------------------------------
// Shared arg vocabularies. Constrained on purpose: a small closed set of enums
// is what makes the SLM distillation target learnable and the traces clean.
// -----------------------------------------------------------------------------

/** Battle policy presets consumed by the C3 battle engine. */
export const BATTLE_STRATEGY = Object.freeze([
    "default",        // Highest-damage effective move; switch on faint.
    "highest_damage", // Always maximize damage, ignore type-switching.
    "type_effective", // Prefer super-effective moves; exploit matchups.
    "conserve_pp",    // Prefer cheap/STAB moves, avoid burning rare PP.
    "level_grind",    // Stay in, farm XP on the lead even at some risk.
    "flee",           // Attempt to run from wild battles.
]);

/** Healing methods consumed by the C4 menu macros. */
export const HEAL_METHOD = Object.freeze([
    "pokecenter", // Route to nearest Pokécenter (A3 graph) and use the nurse.
    "items",      // Use potions/status items from the bag on the party.
    "auto",       // Harness picks: items if sufficient, else Pokécenter.
]);

// -----------------------------------------------------------------------------
// Tool definitions. `parameters` are JSON Schema (draft-2020-12 compatible),
// directly usable as OpenAI/OpenRouter function tool schemas.
// -----------------------------------------------------------------------------

const DESTINATION_SCHEMA = {
    description:
        "Where to go. Either a named location from the location registry (A3) " +
        "or explicit map-local coordinates.",
    oneOf: [
        {
            type: "object",
            required: ["location"],
            additionalProperties: false,
            properties: {
                location: {
                    type: "string",
                    description:
                        "Registry name, e.g. 'Pewter City', 'nearest Pokecenter', " +
                        "'Pewter Gym', 'Viridian Mart'.",
                },
            },
        },
        {
            type: "object",
            required: ["x", "y"],
            additionalProperties: false,
            properties: {
                map: {
                    type: "string",
                    description:
                        "Target map id/name. Omit to target a coordinate on the " +
                        "current map.",
                },
                x: { type: "integer", minimum: 0 },
                y: { type: "integer", minimum: 0 },
            },
        },
    ],
};

const MAX_STEPS_SCHEMA = {
    type: "integer",
    minimum: 1,
    maximum: 2000,
    default: 400,
    description:
        "Step budget. One step ≈ one tile move / one menu action. If exhausted " +
        "before the intent completes, the tool returns status 'budget_exhausted' " +
        "and control returns to the model.",
};

export const TOOLS = Object.freeze([
    {
        name: "goto",
        description:
            "Navigate to a destination. The harness handles within-map A* (C1), " +
            "cross-map routing over warps/connections (C2), trainer-sightline " +
            "avoidance, and live NPC dodging. Returns when the destination is " +
            "reached OR an interrupt fires (battle, dialog, blocked, budget).",
        parameters: {
            type: "object",
            required: ["destination"],
            additionalProperties: false,
            properties: {
                destination: DESTINATION_SCHEMA,
                avoid_trainers: {
                    type: "boolean",
                    default: true,
                    description:
                        "Route around trainer sightline tiles when possible (A2).",
                },
                max_steps: MAX_STEPS_SCHEMA,
            },
        },
    },
    {
        name: "set_battle_strategy",
        description:
            "Set the policy the C3 battle engine follows for subsequent battles. " +
            "Does NOT start or advance a battle and consumes no step budget; it " +
            "only updates the standing policy. The engine escalates back to the " +
            "model on out_of_pp / about_to_faint / unknown_state regardless of " +
            "the strategy set here.",
        parameters: {
            type: "object",
            required: ["strategy"],
            additionalProperties: false,
            properties: {
                strategy: {
                    type: "string",
                    enum: [...BATTLE_STRATEGY],
                    description: "Battle policy preset.",
                },
                lead: {
                    type: "string",
                    description:
                        "Optional nickname/species to keep as the active battler; " +
                        "the engine switches to it when possible.",
                },
                catch_wild: {
                    type: "boolean",
                    default: false,
                    description:
                        "If true, attempt to weaken-and-catch wild encounters " +
                        "instead of defeating/fleeing them.",
                },
            },
        },
    },
    {
        name: "heal",
        description:
            "Restore the party to full HP/PP and clear status. Depending on " +
            "method, routes to the nearest Pokécenter (reusing goto/C2) or applies " +
            "bag items via the C4 menu macros. Returns when the party is healed OR " +
            "an interrupt fires.",
        parameters: {
            type: "object",
            required: [],
            additionalProperties: false,
            properties: {
                method: {
                    type: "string",
                    enum: [...HEAL_METHOD],
                    default: "auto",
                    description: "How to heal.",
                },
                max_steps: MAX_STEPS_SCHEMA,
            },
        },
    },
    {
        name: "use_item",
        description:
            "Use one item from the bag, in the overworld or in battle. The harness " +
            "opens the bag, selects the item, and applies it to the target via the " +
            "C4 menu macros.",
        parameters: {
            type: "object",
            required: ["item"],
            additionalProperties: false,
            properties: {
                item: {
                    type: "string",
                    description:
                        "Exact bag item name, e.g. 'Potion', 'Antidote', " +
                        "'Poke Ball', 'Oak's Parcel'.",
                },
                target_slot: {
                    type: "integer",
                    minimum: 0,
                    maximum: 5,
                    description:
                        "Party slot (0-5) to apply the item to, when the item " +
                        "targets a Pokémon. Omit for items with no party target.",
                },
                quantity: {
                    type: "integer",
                    minimum: 1,
                    maximum: 99,
                    default: 1,
                    description: "How many to use.",
                },
            },
        },
    },
    {
        name: "press",
        description:
            "ESCAPE HATCH. Send a raw button sequence when no higher-level tool " +
            "fits (odd menus, cutscene prompts, minigames). Prefer the structured " +
            "tools; every press call is a candidate for a missing macro and is " +
            "flagged as such in traces.",
        parameters: {
            type: "object",
            required: ["buttons"],
            additionalProperties: false,
            properties: {
                buttons: {
                    type: "array",
                    minItems: 1,
                    maxItems: 32,
                    items: {
                        type: "string",
                        enum: [
                            "a", "b", "l", "r",
                            "start", "select",
                            "up", "down", "left", "right",
                        ],
                    },
                    description: "Ordered button taps to send.",
                },
                max_steps: {
                    type: "integer",
                    minimum: 1,
                    maximum: 32,
                    description:
                        "Cap on presses actually sent (defaults to buttons.length). " +
                        "Bounded low because press is not meant for long sequences.",
                },
            },
        },
    },
]);

/** Fast name→tool lookup for the D2 dispatcher. */
export const TOOLS_BY_NAME = Object.freeze(
    Object.fromEntries(TOOLS.map((t) => [t.name, t]))
);

/**
 * Render the frozen tools as OpenAI/OpenRouter `tools` array entries.
 * @returns {Array<object>}
 */
export function toOpenAITools() {
    return TOOLS.map((t) => ({
        type: "function",
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        },
    }));
}
