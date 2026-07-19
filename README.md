# GeminiPlaysPokemonLive

A pretty frequent request in both the ClaudePlaysPokemon and GeminiPlaysPokemon chats was to have the LLMs receive input and advice from chat. Both said (and I agree) that this did not suit the format of the streams, which were at least partially aimed at demonstrating frontier capabilities of standalone AIs. However, it was a popular enough suggestion that I think it deserves to be implemented somewhere.

This project contains a harness which allows a Gemini AI model to play Pokémon FireRed/LeafGreen/Emerald via an emulator (mGBA). It reads game state information (RAM, screenshots), sends prompts to the Gemini API, processes the AI's decisions, and translates them into button presses in the emulator. 

Unique to this project is that additional outside information is added to the prompt from a Twitch channel, which is used to give advice and hints to the LLM.

!! This project DOES NOT support Ruby/Sapphire, only FRLG/Emerald!

Update May 13: This project is now mostly focused on Emerald development; FRLG implementation is likely to have bugs due to lack of testing. Please create issues in the repository if you are using the FRLG version and notice inconsistencies.

## Dependencies

GeminiPlaysPokemonLive has the following dependencies:
- `openai`: OpenAI-compatible SDK, used to talk to both OpenRouter (the playing model) and Cerebras (the vision model). See `CONFIGS.js` for the model slugs in use.
- `dotenv`: Loads API keys from a `.env` file.
- [mGBA](https://mgba.io/): The mGBA Game Boy Advance emulator.
- [mGBA-http](https://github.com/nikouu/mGBA-http/): Used for interacting with the emulator from the JS code. Make sure you have version 0.5.0 or higher, as it contains a fix necessary to run the memory reading code.
- [sharp](https://github.com/lovell/sharp): Used for screenshot image processing.

## Running the Agent

To run the agent, you will need to:
1.  Install the dependencies: `npm install`
2.  Start mGBA and run a compatible ROM (FireRed, LeafGreen, and Emerald are supported)
3.  Start the mGBA-http server and script on the emulator [see here for details](https://github.com/nikouu/mGBA-http?tab=readme-ov-file#quick-start-guide)
4.  Copy `.env.example` to `.env` (if not already present) and fill in `OPENROUTER_API_KEY` and `CEREBRAS_API_KEY`. Set `POKEMON_GAME_VERSION` to either `FRLG` or `EMERALD` (defaults to `EMERALD`).
5.  Run `node agent.js`.

The agent should now run, and you can watch its thoughts in your terminal and its actions in the emulator. Each turn, the current screenshot is sent to Cerebras for a text description first; only that description (not the raw image) is sent to the OpenRouter model, along with the RAM-derived game state.

## Beta Disclaimer

This project is still in the early beta stage, and as such it is expected that there may be significant bugs or errors yet undiscovered. In addition, some features are not thoroughly tested yet; tweaking will undoubtedly be required. The software is provided for educational purposes, and I do not recommend taking its current state as a finished product.

Also, Gemini 2.5 Pro wrote probably over 75% of this code (not to mention all the help on RAM reading I got from Deep Research). Take from that what you will.

## Contact Me

For questions, help requests, troubleshooting, to contribute, I can be contacted:
- By email: [nicholas.philpott.costa@gmail.com]
- On Discord: `ixoth`