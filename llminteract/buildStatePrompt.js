// =============================================================================
// PURE-TEXT STATE PROMPT (D2)
// =============================================================================
//
// Renders a B1 `getState()` snapshot as the text the model reads each turn.
// This replaces the old D0 prompt, which was a JSON dump of `getGameInfoText`
// output concatenated with a Cerebras-generated screenshot description. D2
// drops the vision call entirely: the model now sees ONLY this text — RAM
// state plus the on-screen collision grid, warps, and NPCs, all sourced from
// the unified snapshot.
//
// Pure (no I/O): given a snapshot object, return a string. Kept separate from
// agent.js so it is unit-testable offline against a constructed snapshot
// (buildStatePrompt.test.js) and so the prompt's shape is reviewable in one
// place. The snapshot sections mirror docs/state-snapshot.md exactly; if a
// section failed to read (snapshot.errors[section]) we say so inline rather
// than silently omitting it, so the model never confuses "absent" with "I
// couldn't read it".
// =============================================================================

/**
 * Compact one-line description of a party member for the prompt's party block.
 * @param {object} p A formatted party member (see getState.js formatPartyMember).
 * @returns {string}
 */
function renderPartyMember(p) {
    if (!p) return "(unreadable party member)";
    const hp =
        typeof p.currentHP === "number" && typeof p.maxHP === "number"
            ? `${p.currentHP}/${p.maxHP} hp`
            : "(hp unreadable)";
    const status = p.statusCondition && p.statusCondition !== "NONE" ? ` [${p.statusCondition}]` : "";
    const fainted = p.fainted ? " FAINTED" : "";
    const moves = Array.isArray(p.moves) && p.moves.length
        ? p.moves.map((m) => `${m.name}(${m.pp ?? "?"}pp)`).join(", ")
        : "(no moves)";
    const types = Array.isArray(p.types) && p.types.length ? p.types.join("/") : "?";
    return `slot ${p.slot}: ${p.nickname ?? "?"} (${p.species ?? "?"}, ${types}) L${p.level ?? "?"} ${hp}${status}${fainted} — moves: ${moves}`;
}

/**
 * Renders the on-screen map block: map identity + dimensions, the collision
 * grid (one line per row, emoji per tile), the on-screen warps, NPCs, and
 * overworld connections. Mirrors the grid the old `saveHumanReadablePromptToFile`
 * emitted, but sourced from the snapshot's `map` section.
 * @param {object} map The snapshot.map section (a visibleBackup map state).
 * @returns {string}
 */
function renderMap(map) {
    if (!map || typeof map !== "object") {
        return "Map: (map read unavailable — navigating blind)";
    }
    const lines = [];
    const name = map.map_name || "(unknown map)";
    const w = map.width ?? "?";
    const h = map.height ?? "?";
    lines.push(`Map: ${name} (${w}x${h})`);

    const grid = Array.isArray(map.map_data) ? map.map_data : [];
    if (grid.length) {
        lines.push("On-screen collision grid (🟩 walkable, 🟥 blocked, ❗ NPC, 🌀 warp, 🔗 connection):");
        for (const row of grid) {
            if (!Array.isArray(row)) continue;
            lines.push(
                row.map((tile) => {
                    if (typeof tile === "string") {
                        const parts = tile.split(":");
                        return parts.length > 1 ? parts[1] : "?";
                    }
                    return "?";
                }).join(" ")
            );
        }
    } else {
        lines.push("(collision grid empty)");
    }

    const warps = Array.isArray(map.warps) ? map.warps : [];
    if (warps.length) {
        lines.push("On-screen warps (complete — if you see one not listed, you are mistaken):");
        for (const wp of warps) {
            const pos = Array.isArray(wp.position) ? `[${wp.position[0]},${wp.position[1]}]` : "(?)";
            lines.push(`  ${pos} -> ${wp.destination ?? "?"}`);
        }
    }

    const npcs = Array.isArray(map.npcs) ? map.npcs : [];
    if (npcs.length) {
        lines.push("On-screen NPCs (complete):");
        for (const npc of npcs) {
            const pos = Array.isArray(npc.position) ? `[${npc.position[0]},${npc.position[1]}]` : "(?)";
            const wander = npc.wandering ? " (wandering)" : "";
            const off = npc.isOffScreen ? " (off-screen)" : "";
            lines.push(`  id ${npc.id ?? "?"} ${pos} ${npc.type ?? "?"}${wander}${off}`);
        }
    }

    const conns = Array.isArray(map.connections) ? map.connections : [];
    const real = conns.filter((c) => c && c.mapName && c.mapName !== "MAP_NONE");
    if (real.length) {
        lines.push("On-screen overworld connections (walk off the indicated edge to cross):");
        for (const c of real) {
            lines.push(`  ${c.direction ?? "?"} -> ${c.mapName}`);
        }
    }

    const ps = map.player_state;
    if (ps) {
        const pos = Array.isArray(ps.position) ? `[${ps.position[0]},${ps.position[1]}]` : "(?)";
        lines.push(`Map player_state: ${pos} facing ${ps.facing ?? "?"}`);
    }

    return lines.join("\n");
}

/**
 * Build the text the model reads for one turn, from a B1 getState() snapshot.
 *
 * Section order is deliberate: identity/location first (so the model orients),
 * then the flags that decide whether it can act at all (battle/dialog lock),
 * then party/bag (resources), then the on-screen map (where it can go). Any
 * section that failed to read is reported inline via `snapshot.errors`.
 *
 * @param {object} state A getState() snapshot.
 * @returns {string}
 */
export function buildStatePrompt(state) {
    if (!state) return "Current game state: (snapshot unavailable)";

    const out = [];
    out.push("=== CURRENT GAME STATE (from emulator RAM) ===");

    // --- Player / location ---
    const p = state.player;
    if (p) {
        const map = p.map || {};
        const pos = p.position ? `[${p.position.x ?? "?"}, ${p.position.y ?? "?"}]` : "(pos unreadable)";
        const movement = p.movement || {};
        const modes = [
            movement.surfing ? "surfing" : null,
            movement.biking ? "biking" : null,
            movement.diving ? "diving" : null,
        ].filter(Boolean);
        out.push(`Location: ${map.name ?? "(map unreadable)"} (bank ${map.bank ?? "?"} num ${map.number ?? "?"})`);
        out.push(`Position: ${pos} facing ${p.facing ?? "?"}, elevation ${p.elevation ?? "?"}${modes.length ? ", " + modes.join("/") : ""}`);
        out.push(`Money: ${p.money ?? "?"}. Badges: ${Array.isArray(p.badges) && p.badges.length ? p.badges.join(", ") : "none"}`);
    } else {
        out.push("Player: (unreadable)");
    }

    // --- Progress / battle / menu flags ---
    out.push(`In battle: ${state.battle?.active ?? "?"}`);
    out.push(`Overworld controls locked (dialog/cutscene/script): ${state.progress?.controlsLocked ?? "?"}`);
    const menu = state.menu || {};
    out.push(`Party menu open: ${menu.partyMenuOpen ?? "?"} (slot ${menu.partyMenuSlot ?? "?"})`);

    // --- Party ---
    const party = state.party;
    if (party) {
        out.push(`Party (${party.count ?? "?"}):`);
        if (Array.isArray(party.pokemon) && party.pokemon.length) {
            for (const mem of party.pokemon) out.push("  " + renderPartyMember(mem));
        } else {
            out.push("  (no Pokémon read)");
        }
    } else {
        out.push("Party: (unreadable)");
    }

    // --- Bag ---
    if (state.bag && typeof state.bag === "object") {
        const pouches = Object.entries(state.bag).filter(([, v]) => Array.isArray(v) && v.length);
        if (pouches.length) {
            out.push("Bag:");
            for (const [pouch, items] of pouches) {
                out.push(`  ${pouch}: ${items.map((i) => `${i?.name ?? i?.item ?? "?"} x${i?.quantity ?? i?.count ?? 1}`).join(", ")}`);
            }
        } else {
            out.push("Bag: (empty or unreadable)");
        }
    } else {
        out.push("Bag: (not included this poll)");
    }

    // --- On-screen map ---
    out.push(renderMap(state.map));

    // --- Read errors ---
    const errs = state.errors;
    if (errs && Object.keys(errs).length) {
        out.push("Read errors (these sections were unreadable this poll):");
        for (const [section, msg] of Object.entries(errs)) out.push(`  ${section}: ${msg}`);
    }

    return out.join("\n");
}

/**
 * Compact one-line rendering of a tool outcome, for the conversation history
 * (the `tool` message content the model sees after a macro runs). Keeps the
 * model's context small while preserving the stop_reason + step accounting.
 * @param {object} outcome A makeOutcome() envelope.
 * @returns {string}
 */
export function renderOutcomeText(outcome) {
    if (!outcome) return "(no outcome)";
    const parts = [`status=${outcome.status}`, `stop_reason=${outcome.stop_reason ?? "none"}`, `steps_used=${outcome.steps_used ?? 0}`];
    if (outcome.message) parts.push(`msg="${outcome.message}"`);
    if (outcome.state_delta) parts.push(`delta=${JSON.stringify(outcome.state_delta)}`);
    return parts.join(" | ");
}
