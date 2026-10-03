const { Rcon } = require("rcon-client");

async function executeRcon(server, command) {
if (!server || !server.rconPort || !server.rconPassword) {
return {
online: false,
response: "",
error: "RCON is not configured for this server."
};
}

const rcon = new Rcon({
    host: server.host || "127.0.0.1",
    port: Number(server.rconPort),
    password: server.rconPassword,
    timeout: 5000
});

try {
    await rcon.connect();

    const response = await rcon.send(command);

    try {
        await rcon.end();
    } catch {}

    return {
        online: true,
        response: response || "",
        error: null
    };
} catch (error) {
    try {
        await rcon.end();
    } catch {}

    return {
        online: false,
        response: "",
        error: error.message
    };
}

}

async function getPlayers(server) {
const result = await executeRcon(server, "list");

if (!result.online) {
    return {
        online: false,
        players: [],
        playerCount: 0,
        maxPlayers: server.maxPlayers || 0,
        error: result.error
    };
}

const response = String(result.response || "");

let playerCount = 0;
let maxPlayers = Number(server.maxPlayers || 0);
let players = [];

/*
 * Paper/Spigot/Vanilla/Fabric commonly return:
 *
 * There are 2 of a max of 20 players online: Steve, Alex
 */

const match = response.match(
    /There are\s+(\d+)\s+of\s+a\s+max(?:imum)?\s+of\s+(\d+)\s+players?\s+online/i
);

if (match) {
    playerCount = Number(match[1]);
    maxPlayers = Number(match[2]);
}

/*
 * Find the player list after the colon.
 */
const colonIndex = response.lastIndexOf(":");

if (colonIndex !== -1) {
    const playerText = response
        .substring(colonIndex + 1)
        .trim();

    if (playerText.length > 0) {
        players = playerText
            .split(",")
            .map(player => player.trim())
            .filter(Boolean);
    }
}

/*
 * Some servers may return a player count but no player names.
 */
if (playerCount === 0) {
    players = [];
}

return {
    online: true,
    players,
    playerCount,
    maxPlayers,
    error: null
};

}

async function getServerStatus(server) {
const result = await getPlayers(server);

return {
    online: result.online,
    players: result.players,
    playerCount: result.playerCount,
    maxPlayers: result.maxPlayers,
    error: result.error || null
};

}

async function getTPS(server) {
/*
* Minecraft 1.21.x supports:
*
* /tick query
*
* Paper also supports:
*
* /tps
*/

let result = await executeRcon(server, "tick query");

if (!result.online) {
    result = await executeRcon(server, "tps");
}

if (!result.online) {
    return null;
}

const text = String(result.response || "");

/*
 * Look for values between 0 and 20.1.
 */
const matches = text.match(/\d+(?:\.\d+)?/g);

if (!matches) {
    return null;
}

for (const value of matches) {
    const number = Number(value);

    if (number >= 0 && number <= 20.1) {
        return Number(number.toFixed(2));
    }
}

return null;

}

async function getVersion(server) {
const result = await executeRcon(server, "version");

if (!result.online) {
    return null;
}

return result.response || null;

}

async function getServerVersion(server) {
return getVersion(server);
}

module.exports = {
executeRcon,
getPlayers,
getServerStatus,
getTPS,
getVersion,
getServerVersion
};
