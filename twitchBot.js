import * as tmi from 'tmi.js';
import fs from 'fs';

const client = new tmi.Client({
	channels: [ 'TwitchAndGeminiPlayPokemon' ]
});

client.connect();

// On message, write the display name and message contents to the file twitch_chat.txt
client.on('message', (channel, tags, message, self) => {
	fs.appendFile('twitch_chat.txt', `${tags['display-name']}: ${message}\n`, (err) => {
		if (err) throw err;
	});
});