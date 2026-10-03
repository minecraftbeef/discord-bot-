const fs = require("fs");
const path = require("path");

const {
    getPlayers,
    getTPS
} = require("./rcon");

const servers = require("../servers.json");

const serverState = {};

function initializeServerState() {

    for (const [id] of Object.entries(servers)) {

        serverState[id] = {
            startedAt: null,
            lastOnline: false,
            lastPlayers: [],
            statusMessages: {},
            logPosition: 0,
            logInitialized: false
        };
    }
}

function formatUptime(startedAt) {

    if (!startedAt) {
        return "Unknown";
    }

    const seconds = Math.max(
        0,
        Math.floor((Date.now() - startedAt) / 1000)
    );

    const days = Math.floor(seconds / 86400);

    const hours = Math.floor(
        (seconds % 86400) / 3600
    );

    const minutes = Math.floor(
        (seconds % 3600) / 60
    );

    const secs = seconds % 60;

    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    }

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    }

    return `${secs}s`;
}

function getMemory(server) {

    if (!server.systemdService) {
        return null;
    }

    const service = server.systemdService;

    const currentPath =
        `/sys/fs/cgroup/system.slice/${service}.service/memory.current`;

    const maxPath =
        `/sys/fs/cgroup/system.slice/${service}.service/memory.max`;

    try {

        if (!fs.existsSync(currentPath)) {
            return null;
        }

        const current = Number(
            fs.readFileSync(
                currentPath,
                "utf8"
            ).trim()
        );

        let max = 0;

        if (fs.existsSync(maxPath)) {

            const maxText = fs.readFileSync(
                maxPath,
                "utf8"
            ).trim();

            if (maxText !== "max") {
                max = Number(maxText);
            }
        }

        return {
            current,
            max
        };

    } catch (error) {

        console.error(
            `[MEMORY] ${server.name}: ${error.message}`
        );

        return null;
    }
}

function formatBytes(bytes) {

    if (!bytes || Number.isNaN(bytes)) {
        return "Unknown";
    }

    const gb = bytes / 1024 / 1024 / 1024;

    if (gb >= 1) {
        return `${gb.toFixed(1)} GB`;
    }

    const mb = bytes / 1024 / 1024;

    return `${mb.toFixed(0)} MB`;
}

function formatMemory(memory) {

    if (!memory) {
        return {
            current: "Unknown",
            max: "Unknown"
        };
    }

    return {
        current: formatBytes(memory.current),
        max:
            memory.max > 0
                ? formatBytes(memory.max)
                : "Unlimited"
    };
}

async function getServerInfo(id, server) {

    if (!serverState[id]) {
        serverState[id] = {
            startedAt: null,
            lastOnline: false,
            lastPlayers: [],
            statusMessages: {},
            logPosition: 0,
            logInitialized: false
        };
    }

    /*
     * Coming-soon servers do not use RCON.
     */

    if (server.comingSoon) {

        return {
            online: false,
            comingSoon: true,
            players: [],
            playerCount: 0,
            maxPlayers: server.maxPlayers || 0,
            uptime: "Coming soon",
            tps: null,
            memory: null,
            memoryFormatted: {
                current: "Unknown",
                max: "Unknown"
            }
        };
    }

    const players = await getPlayers(server);

    if (!players.online) {

        serverState[id].lastOnline = false;

        return {
            online: false,
            comingSoon: false,
            players: [],
            playerCount: 0,
            maxPlayers: server.maxPlayers || 0,
            uptime: "Offline",
            tps: null,
            memory: null,
            memoryFormatted: {
                current: "Unknown",
                max: "Unknown"
            }
        };
    }

    /*
     * Detect server startup.
     */

    if (!serverState[id].lastOnline) {

        serverState[id].startedAt = Date.now();

        console.log(
            `[STATUS] ${server.name} came online.`
        );
    }

    serverState[id].lastOnline = true;

    serverState[id].lastPlayers = players.players;

    let tps = null;

    try {
        tps = await getTPS(server);
    } catch (error) {
        console.error(
            `[TPS] ${server.name}: ${error.message}`
        );
    }

    const memory = await getMemory(server);

    return {
        online: true,
        comingSoon: false,

        players: players.players,

        playerCount: players.playerCount,

        maxPlayers:
            players.maxPlayers ||
            server.maxPlayers ||
            0,

        uptime: formatUptime(
            serverState[id].startedAt
        ),

        tps,

        memory,

        memoryFormatted: formatMemory(memory)
    };
}

function getLatestLog(server) {

    if (!server.directory) {
        return null;
    }

    return path.join(
        server.directory,
        "logs",
        "latest.log"
    );
}

function parseChatLine(line) {

    /*
     * Standard:
     *
     * [08:42:10] [Server thread/INFO]: <Player> Hello
     *
     * Fabric:
     *
     * [08:42:10] [Server thread/INFO]: <Player> Hello
     *
     * Some versions:
     *
     * [08:42:10] [Server thread/INFO]: [Not Secure] <Player> Hello
     */

    const match = line.match(
        /^\[(\d{2}:\d{2}:\d{2})\].*?:\s*(?:\[Not Secure\]\s*)?<([^>]+)>\s(.+)$/
    );

    if (!match) {
        return null;
    }

    return {
        time: match[1],
        player: match[2],
        message: match[3].trim()
    };
}

async function sendDiscordChat(
    client,
    server,
    guildId,
    discordConfig,
    chat
) {

    if (!discordConfig.chatChannelId) {
        return;
    }

    try {

        const guild =
            client.guilds.cache.get(guildId);

        if (!guild) {

            console.log(
                `[CHAT] ${server.name}: Bot is not in Discord server ${guildId}`
            );

            return;
        }

        const channel =
            await guild.channels.fetch(
                discordConfig.chatChannelId
            );

        if (!channel) {

            console.log(
                `[CHAT] ${server.name}: Channel ${discordConfig.chatChannelId} not found`
            );

            return;
        }

        /*
         * Make sure this is a text-based channel.
         */

        if (!channel.isTextBased()) {

            console.log(
                `[CHAT] ${server.name}: Channel ${discordConfig.chatChannelId} is not a text channel`
            );

            return;
        }

        /*
         * Check bot permissions.
         */

        const permissions =
            channel.permissionsFor(
                guild.members.me
            );

        if (
            !permissions ||
            !permissions.has("SendMessages")
        ) {

            console.log(
                `[CHAT] ${server.name}: Missing Send Messages permission in #${channel.name}`
            );

            return;
        }

        let message =
            `[${chat.time}] **${chat.player}:** ${chat.message}`;

        /*
         * Discord has a 2000 character message limit.
         */

        if (message.length > 1900) {
            message =
                message.substring(0, 1900) +
                "...";
        }

        await channel.send(message);

        console.log(
            `[CHAT] ${server.name} -> ${guild.name} #${channel.name}: ${chat.player}: ${chat.message}`
        );

    } catch (error) {

        console.error(
            `[CHAT] ${server.name} -> ${guildId}: ${error.message}`
        );
    }
}

async function checkChatLog(
    client,
    id,
    server
) {

    if (server.comingSoon) {
        return;
    }

    if (!server.discord) {
        return;
    }

    if (!serverState[id]) {
        return;
    }

    const logPath =
        getLatestLog(server);

    if (!logPath) {
        return;
    }

    if (!fs.existsSync(logPath)) {
        return;
    }

    let stat;

    try {

        stat = fs.statSync(logPath);

    } catch (error) {

        console.error(
            `[CHAT] ${server.name}: Unable to read log: ${error.message}`
        );

        return;
    }

    /*
     * First time seeing this log.
     *
     * Start at the end so we don't send
     * thousands of old messages.
     */

    if (!serverState[id].logInitialized) {

        serverState[id].logPosition =
            stat.size;

        serverState[id].logInitialized =
            true;

        console.log(
            `[CHAT] ${server.name}: Chat log initialized at ${stat.size} bytes.`
        );

        return;
    }

    /*
     * Minecraft restarted or rotated the log.
     */

    if (
        serverState[id].logPosition >
        stat.size
    ) {

        console.log(
            `[CHAT] ${server.name}: Log rotated/restarted.`
        );

        serverState[id].logPosition = 0;
    }

    if (
        stat.size ===
        serverState[id].logPosition
    ) {
        return;
    }

    let data = "";

    try {

        const stream =
            fs.createReadStream(
                logPath,
                {
                    start:
                        serverState[id].logPosition,

                    end:
                        stat.size - 1
                }
            );

        for await (
            const chunk of stream
        ) {
            data += chunk.toString();
        }

    } catch (error) {

        console.error(
            `[CHAT] ${server.name}: Failed reading log: ${error.message}`
        );

        return;
    }

    serverState[id].logPosition =
        stat.size;

    if (!data) {
        return;
    }

    const lines =
        data.split(/\r?\n/);

    for (const line of lines) {

        const chat =
            parseChatLine(line);

        if (!chat) {
            continue;
        }

        for (
            const [
                guildId,
                discordConfig
            ] of Object.entries(
                server.discord
            )
        ) {

            await sendDiscordChat(
                client,
                server,
                guildId,
                discordConfig,
                chat
            );
        }
    }
}

initializeServerState();

module.exports = {
    serverState,
    getServerInfo,
    checkChatLog,
    formatGB: formatBytes,
    formatBytes,
    formatMemory,
    formatUptime
};
