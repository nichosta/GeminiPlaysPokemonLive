import * as tmi from 'tmi.js';
import fs from 'fs';

const client = new tmi.Client({
	channels: [ 'Iksoth' ]
});

client.connect();

// On message, write the display name and message contents to the file twitch_chat.txt
client.on('message', (channel, tags, message, self) => {
	if (self) return; // Ignore messages from the bot itself (to be used once the bot actually sends messages)
	if (message.trim().charAt(0) === '~') { // Use messages that start with '~'
		fs.appendFile('twitch_chat.txt', `${tags['display-name']}: ${message.slice(1)}\n`, (err) => {
			if (err) throw err;
		});
	} else {
		return;
	}
});