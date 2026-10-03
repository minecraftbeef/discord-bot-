require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    ActivityType,
    REST,
    Routes,
    PermissionFlagsBits
} = require("discord.js");

const {
    commands,
    handleCommand
} = require("./commands");

const {
    getServerInfo,
    checkChatLog,
    serverState,
    formatGB
} = require("./serverMonitor");

const servers = require("../servers.json");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function isComingSoon(server) {
    return server.comingSoon === true;
}

function buildStatusEmbed(server, info) {

    /*
     * Coming Soon
     */

    if (isComingSoon(server)) {

        const embed = new (require("discord.js").EmbedBuilder)()
            .setTitle(
                `${server.emoji || "🖥️"} ${server.name}`
            )
            .setDescription(
                "━━━━━━━━━━━━━━━━━━━━"
            )
            .addFields({
                name: "🟡 Status",
                value: "Coming Soon",
                inline: false
            })
            .setTimestamp();

        if (server.software) {
            embed.addFields({
                name: "📦 Software",
                value: server.software,
                inline: true
            });
        }

        if (server.minecraftVersion) {
            embed.addFields({
                name: "🎮 Minecraft",
                value: server.minecraftVersion,
                inline: true
            });
        }

        if (server.modpackUrl) {
            embed.addFields({
                name: "📦 Modpack",
                value: `[Download Modpack](${server.modpackUrl})`,
                inline: false
            });
        }

        embed.setFooter({
            text: "This server is coming soon."
        });

        return embed;
    }

    /*
     * Normal server
     */

    const { EmbedBuilder } = require("discord.js");

    const embed = new EmbedBuilder()
        .setTitle(
            `${server.emoji || "🖥️"} ${server.name}`
        )
        .setDescription(
            "━━━━━━━━━━━━━━━━━━━━"
        )
        .setTimestamp();

    /*
     * Offline
     */

    if (!info.online) {

        embed.addFields({
            name: "🔴 Status",
            value: "Offline",
            inline: false
        });

        if (server.software) {
            embed.addFields({
                name: "📦 Software",
                value: server.software,
                inline: true
            });
        }

        if (server.minecraftVersion) {
            embed.addFields({
                name: "🎮 Minecraft",
                value: server.minecraftVersion,
                inline: true
            });
        }

        if (server.modpackUrl) {
            embed.addFields({
                name: "📦 Modpack",
                value: `[Download Modpack](${server.modpackUrl})`,
                inline: false
            });
        }

        embed.setFooter({
            text:
                `Last updated: ${new Date().toLocaleTimeString()}`
        });

        return embed;
    }

    /*
     * Online
     */

    embed.addFields(
        {
            name: "🟢 Status",
            value: "Online",
            inline: true
        },
        {
            name: "⏱️ Uptime",
            value: info.uptime || "Unknown",
            inline: true
        },
        {
            name: "👥 Players",
            value:
                `${info.playerCount}/${info.maxPlayers}`,
            inline: true
        },
        {
            name: "📦 Software",
            value:
                server.software || "Unknown",
            inline: true
        },
        {
            name: "🎮 Minecraft",
            value:
                server.minecraftVersion || "Unknown",
            inline: true
        },
        {
            name: "⚡ TPS",
            value:
                info.tps !== null &&
                info.tps !== undefined
                    ? `${info.tps}`
                    : "Unknown",
            inline: true
        }
    );

    /*
     * RAM
     */

    let ramText = "Unknown";

    if (info.memory) {

        const current =
            formatGB(info.memory.current);

        const max =
            info.memory.max
                ? formatGB(info.memory.max)
                : "Unlimited";

        ramText =
            `${current} / ${max}`;
    }

    embed.addFields({
        name: "💾 RAM",
        value: ramText,
        inline: true
    });

    /*
     * Players
     */

    const playerText =
        info.players &&
        info.players.length > 0
            ? info.players
                .map(player => `• ${player}`)
                .join("\n")
            : "• Nobody online";

    embed.addFields({
        name: "👥 Players Online",
        value: playerText.substring(0, 1024)
    });

    /*
     * Modpack
     */

    if (server.modpackUrl) {

        embed.addFields({
            name: "📦 Modpack",
            value:
                `[Download Modpack](${server.modpackUrl})`,
            inline: false
        });
    }

    embed.setFooter({
        text:
            `Last updated: ${new Date().toLocaleTimeString()}`
    });

    return embed;
}

/*
|--------------------------------------------------------------------------
| Discord permissions
|--------------------------------------------------------------------------
*/

async function canSendMessages(channel, guild) {

    try {

        if (!channel) {
            return false;
        }

        if (!channel.isTextBased()) {
            return false;
        }

        const member =
            guild.members.me ||
            await guild.members.fetchMe();

        if (!member) {
            return false;
        }

        const permissions =
            channel.permissionsFor(member);

        if (!permissions) {
            return false;
        }

        const required = [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages
        ];

        return required.every(permission =>
            permissions.has(permission)
        );

    } catch (error) {

        console.error(
            `[DISCORD] Permission check failed: ${error.message}`
        );

        return false;
    }
}

/*
|--------------------------------------------------------------------------
| Automatic status message
|--------------------------------------------------------------------------
*/

async function updateServerStatus(id, server) {

    console.log(
        `[STATUS] Checking ${server.name}...`
    );

    /*
     * Coming Soon servers don't need RCON.
     */

    let info;

    if (isComingSoon(server)) {

        info = {
            online: false,
            players: [],
            playerCount: 0,
            maxPlayers: server.maxPlayers || 0,
            uptime: "Coming Soon",
            tps: null,
            memory: null
        };

    } else {

        info =
            await getServerInfo(
                id,
                server
            );
    }

    if (!server.discord) {
        return;
    }

    for (
        const [
            guildId,
            config
        ] of Object.entries(server.discord)
    ) {

        if (!config.statusChannelId) {
            continue;
        }

        try {

            const guild =
                client.guilds.cache.get(guildId);

            if (!guild) {

                console.log(
                    `[STATUS] ${server.name}: Bot is not in Discord server ${guildId}`
                );

                continue;
            }

            const channel =
                await guild.channels.fetch(
                    config.statusChannelId
                );

            if (!channel) {

                console.log(
                    `[STATUS] ${server.name}: Channel ${config.statusChannelId} not found`
                );

                continue;
            }

            const allowed =
                await canSendMessages(
                    channel,
                    guild
                );

            if (!allowed) {

                console.log(
                    `[STATUS] ${server.name}: Missing View Channel or Send Messages permission in ${config.statusChannelId}`
                );

                continue;
            }

            const embed =
                buildStatusEmbed(
                    server,
                    info
                );

            let message = null;

            /*
             * Try existing status message.
             */

            if (
                serverState[id] &&
                serverState[id].statusMessages &&
                serverState[id].statusMessages[guildId]
            ) {

                try {

                    message =
                        await channel.messages.fetch(
                            serverState[id]
                                .statusMessages[guildId]
                        );

                } catch {

                    message = null;
                }
            }

            /*
             * Edit existing message.
             */

            if (message) {

                await message.edit({
                    embeds: [embed]
                });

                console.log(
                    `[STATUS] ${server.name}: Updated status message`
                );

                continue;
            }

            /*
             * Create new message.
             */

            const newMessage =
                await channel.send({
                    embeds: [embed]
                });

            if (!serverState[id]) {

                serverState[id] = {
                    startedAt: null,
                    lastOnline: false,
                    lastPlayers: [],
                    statusMessages: {},
                    logPosition: 0
                };
            }

            if (!serverState[id].statusMessages) {
                serverState[id].statusMessages = {};
            }

            serverState[id]
                .statusMessages[guildId] =
                newMessage.id;

            console.log(
                `[STATUS] ${server.name}: Created status message in ${guild.name}`
            );

        } catch (error) {

            console.error(
                `[STATUS] ${server.name} / ${guildId}:`,
                error
            );
        }
    }
}

/*
|--------------------------------------------------------------------------
| Update all servers
|--------------------------------------------------------------------------
*/

async function updateAllServers() {

    for (
        const [
            id,
            server
        ] of Object.entries(servers)
    ) {

        try {

            await updateServerStatus(
                id,
                server
            );

        } catch (error) {

            console.error(
                `[STATUS] ${server.name}:`,
                error
            );
        }

        /*
         * Chat log
         */

        try {

            if (!isComingSoon(server)) {

                await checkChatLog(
                    client,
                    id,
                    server
                );
            }

        } catch (error) {

            console.error(
                `[CHAT] ${server.name}:`,
                error
            );
        }
    }
}

/*
|--------------------------------------------------------------------------
| Register slash commands
|--------------------------------------------------------------------------
|
| Register directly to every Discord server the bot is currently in.
| This makes commands appear much faster than global commands.
|--------------------------------------------------------------------------
*/

async function registerCommands() {

    if (!process.env.DISCORD_TOKEN) {

        throw new Error(
            "DISCORD_TOKEN is missing from .env"
        );
    }

    if (!process.env.CLIENT_ID) {

        throw new Error(
            "CLIENT_ID is missing from .env"
        );
    }

    const rest =
        new REST({
            version: "10"
        }).setToken(
            process.env.DISCORD_TOKEN
        );

    const commandData =
        commands.map(command =>
            command.toJSON()
        );

    /*
     * Register in every Discord server
     * where the bot is installed.
     */

    for (const guild of client.guilds.cache.values()) {

        try {

            await rest.put(
                Routes.applicationGuildCommands(
                    process.env.CLIENT_ID,
                    guild.id
                ),
                {
                    body: commandData
                }
            );

            console.log(
                `[DISCORD] Registered ${commandData.length} commands in ${guild.name} (${guild.id})`
            );

        } catch (error) {

            console.error(
                `[DISCORD] Failed to register commands in ${guild.name}:`,
                error.message
            );
        }
    }
}

/*
|--------------------------------------------------------------------------
| Interaction handler
|--------------------------------------------------------------------------
|
| commands.js handles ALL commands.
|--------------------------------------------------------------------------
*/

client.on(
    "interactionCreate",
    async interaction => {

        if (!interaction.isChatInputCommand()) {
            return;
        }

        console.log(
            `[DISCORD] Command received: /${interaction.commandName}`
        );

        try {

            await handleCommand(
                interaction
            );

        } catch (error) {

            console.error(
                "[DISCORD] Command error:",
                error
            );

            try {

                if (
                    interaction.deferred ||
                    interaction.replied
                ) {

                    await interaction.editReply(
                        `❌ Something went wrong.\n\`${error.message}\``
                    );

                } else {

                    await interaction.reply({
                        content:
                            `❌ Something went wrong.\n\`${error.message}\``,
                        ephemeral: true
                    });
                }

            } catch (replyError) {

                console.error(
                    "[DISCORD] Could not send error reply:",
                    replyError
                );
            }
        }
    }
);

/*
|--------------------------------------------------------------------------
| Discord ready
|--------------------------------------------------------------------------
*/

client.once(
    "clientReady",
    async () => {

        console.log(
            `Logged in as ${client.user.tag}`
        );

        console.log(
            `Discord servers: ${client.guilds.cache.size}`
        );

        console.log(
            `Minecraft servers configured: ${Object.keys(servers).length}`
        );

        client.user.setPresence({
            activities: [
                {
                    name:
                        `${Object.keys(servers).length} Minecraft servers`,
                    type:
                        ActivityType.Watching
                }
            ],
            status: "online"
        });

        /*
         * Register commands in every Discord server.
         */

        try {

            await registerCommands();

        } catch (error) {

            console.error(
                "[DISCORD] Command registration failed:",
                error.message
            );
        }

        /*
         * Initial status update.
         */

        await updateAllServers();

        /*
         * Status updates every 5 minutes.
         */

        setInterval(
            async () => {

                try {

                    await updateAllServers();

                } catch (error) {

                    console.error(
                        "[STATUS] Update error:",
                        error
                    );
                }

            },
            5 * 60 * 1000
        );

        /*
         * Chat checking every 5 seconds.
         */

        setInterval(
            async () => {

                for (
                    const [
                        id,
                        server
                    ] of Object.entries(
                        servers
                    )
                ) {

                    if (isComingSoon(server)) {
                        continue;
                    }

                    try {

                        await checkChatLog(
                            client,
                            id,
                            server
                        );

                    } catch (error) {

                        console.error(
                            `[CHAT] ${server.name}:`,
                            error
                        );
                    }
                }

            },
            5000
        );

    }
);

/*
|--------------------------------------------------------------------------
| Login
|--------------------------------------------------------------------------
*/

if (!process.env.DISCORD_TOKEN) {

    console.error(
        "❌ DISCORD_TOKEN is missing from .env"
    );

    process.exit(1);
}

if (!process.env.CLIENT_ID) {

    console.error(
        "❌ CLIENT_ID is missing from .env"
    );

    process.exit(1);
}

client.login(
    process.env.DISCORD_TOKEN
).catch(error => {

    console.error(
        "❌ Discord login failed:"
    );

    console.error(error);

    process.exit(1);
});
