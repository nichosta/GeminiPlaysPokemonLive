# GeminiPlaysPokemonLive

A pretty frequent request in both the ClaudePlaysPokemon and GeminiPlaysPokemon chats was to have the LLMs receive input and advice from chat. Both said (and I agree) that this did not suit the format of the streams, which were at least partially aimed at demonstrating frontier capabilities of standalone AIs. However, it was a popular enough suggestion that I think it deserves to be implemented somewhere.

This project contains a harness which allows a Gemini AI model to play Pokémon FireRed via an emulator (mGBA). It reads game state information (RAM, screenshots), sends prompts to the Gemini API, processes the AI's decisions, and translates them into button presses in the emulator. 

Unique to this project is that additional outside information is added to the prompt (currently read from a text file), which is used to give advice and hints to the LLM.

If you're here on day 1, Twitch chat integration hasn't been implemented yet - we're on the way there, but I wanted to get the core harness working first. Give me some time (or make a pull request).

## Dependencies

GeminiPlaysPokemonLive has the following dependencies:
- `@google/genai`: The API used for interfacing with Gemini. If you want, you can switch this out for a different API, e.g. OpenRouter, Anthropic, but you will likely have to change the prompt format.
- [mGBA](https://mgba.io/): The mGBA Game Boy Advance emulator.
- [mGBA-http](https://github.com/nikouu/mGBA-http/): Used for interacting with the emulator from the JS code.

## Running the Agent

To run the agent, you will need to:
1.  Install the dependencies: `npm install`
2.  Start mGBA and run a compatible ROM (LeafGreen might also work, I haven't checked)
3.  Start the mGBA-http server and script on the emulator [see here for details](https://github.com/nikouu/mGBA-http?tab=readme-ov-file#quick-start-guide)
4.  Set the `GOOGLE_API_KEY` environment variable to your Google AI API key
5.  Run `node agent.js`.

The agent should now run, and you can watch its thoughts in your terminal and its actions in the emulator. If you want to give it advice, enter text in `twitch_chat.txt` and save; on the next iteration, it will receive it.

## Beta Disclaimer

This project is still in the early beta stage, and as such it is expected that there may be significant bugs or errors yet undiscovered. In addition, some features are not thoroughly tested yet; tweaking will undoubtedly be required. The software is provided for educational purposes, and I do not recommend taking its current state as a finished product.

Also, Gemini 2.5 Pro wrote probably over 75% of this code (not to mention all the help on RAM reading I got from Deep Research). Take from that what you will.

## Contact Me

For questions, help requests, troubleshooting, to contribute, I can be contacted:
- By email: [nicholas.philpott.costa@gmail.com]
- On Discord: `ixoth`