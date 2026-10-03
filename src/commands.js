const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require("discord.js");

const {
    getServerStatus,
    getServerVersion,
    executeRcon
} = require("./rcon");

const servers = require("../servers.json");

function serverChoices() {
    return Object.entries(servers)
        .slice(0, 25)
        .map(([id, server]) => ({
            name: server.name,
            value: id
        }));
}

function getServer(serverId) {
    if (!serverId) {
        return null;
    }

    return servers[serverId.toLowerCase()] || null;
}

function isComingSoon(server) {
    return server.comingSoon === true;
}

function serverOption(option) {
    return option
        .setName("server")
        .setDescription("Minecraft server")
        .setRequired(true)
        .addChoices(...serverChoices());
}

const commands = [
    new SlashCommandBuilder()
        .setName("help")
        .setDescription("Show Minecraft server bot commands"),

    new SlashCommandBuilder()
        .setName("servers")
        .setDescription("List all Minecraft servers"),

    new SlashCommandBuilder()
        .setName("status")
        .setDescription("Show Minecraft server status")
        .addStringOption(serverOption),

    new SlashCommandBuilder()
        .setName("players")
        .setDescription("Show online players")
        .addStringOption(serverOption),

    new SlashCommandBuilder()
        .setName("start")
        .setDescription("Start a Minecraft server")
        .addStringOption(serverOption),

    new SlashCommandBuilder()
        .setName("stop")
        .setDescription("Stop a Minecraft server")
        .addStringOption(serverOption),

    new SlashCommandBuilder()
        .setName("restart")
        .setDescription("Restart a Minecraft server")
        .addStringOption(serverOption),

    new SlashCommandBuilder()
        .setName("server")
        .setDescription("Send a command to a Minecraft server console")
        .addStringOption(serverOption)
        .addStringOption(option =>
            option
                .setName("command")
                .setDescription("Minecraft console command")
                .setRequired(true)
        )
];

function buildHelpEmbed() {
    return new EmbedBuilder()
        .setTitle("🦘 Minecraft Servers Bot")
        .setDescription(
            [
                "**Server Commands**",
                "`/status` — Show server status",
                "`/servers` — List all Minecraft servers",
                "`/players` — Show online players",
                "",
                "**Information**",
                "`/help` — Show this help message",
                "",
                "**Admin**",
                "`/restart` — Restart a Minecraft server",
                "`/start` — Start a Minecraft server",
                "`/stop` — Stop a Minecraft server",
                "`/server` — Send a command to a server console"
            ].join("\n")
        )
        .setTimestamp();
}

function buildComingSoonEmbed(server) {
    return new EmbedBuilder()
        .setTitle(`${server.emoji || "🖥️"} ${server.name}`)
        .setDescription(
            "🚧 **Coming Soon**\n\n" +
            "This Minecraft server is not available yet."
        )
        .setTimestamp();
}

function buildServerEmbed(server, status) {
    const embed = new EmbedBuilder()
        .setTitle(`${server.emoji || "🖥️"} ${server.name}`)
        .setTimestamp();

    if (!status.online) {
        embed.setDescription("🔴 **Offline**");
        return embed;
    }

    embed.setDescription("🟢 **Online**");

    embed.addFields(
        {
            name: "👥 Players",
            value: `${status.playerCount}/${status.maxPlayers}`,
            inline: true
        },
        {
            name: "📦 Software",
            value: server.software || "Unknown",
            inline: true
        },
        {
            name: "🎮 Minecraft",
            value: server.minecraftVersion || "Unknown",
            inline: true
        }
    );

    /*
     * Modpack
     */
    if (
        server.modpack &&
        server.modpack.url
    ) {
        embed.addFields({
            name: "📦 Modpack",
            value: `[${server.modpack.name || "Download Modpack"}](${server.modpack.url})`,
            inline: false
        });
    }

    /*
     * Players
     */
    if (
        status.players &&
        status.players.length > 0
    ) {
        const players = status.players
            .map(player => `• ${player}`)
            .join("\n")
            .substring(0, 1024);

        embed.addFields({
            name: "👤 Players Online",
            value: players
        });
    }

    return embed;
}

function isAdmin(interaction) {
    return interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
    );
}

async function handleCommand(interaction) {

    if (!interaction.isChatInputCommand()) {
        return;
    }

    const commandName = interaction.commandName;

    /*
     * /help
     */
    if (commandName === "help") {
        await interaction.reply({
            embeds: [buildHelpEmbed()]
        });

        return;
    }

    /*
     * /servers
     */
    if (commandName === "servers") {

        await interaction.deferReply();

        const lines = [];

        for (const [id, server] of Object.entries(servers)) {

            if (isComingSoon(server)) {

                lines.push(
                    `${server.emoji || "🖥️"} **${server.name}** — 🚧 Coming Soon`
                );

                continue;
            }

            try {

                const status = await getServerStatus(server);

                if (status.online) {

                    lines.push(
                        `${server.emoji || "🖥️"} **${server.name}** — 🟢 Online (${status.playerCount}/${status.maxPlayers})`
                    );

                } else {

                    lines.push(
                        `${server.emoji || "🖥️"} **${server.name}** — 🔴 Offline`
                    );
                }

            } catch {

                lines.push(
                    `${server.emoji || "🖥️"} **${server.name}** — ⚠️ Error`
                );
            }
        }

        const embed = new EmbedBuilder()
            .setTitle("🦘 Minecraft Servers")
            .setDescription(
                lines.length > 0
                    ? lines.join("\n")
                    : "No Minecraft servers configured."
            )
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed]
        });

        return;
    }

    /*
     * Commands below require a server.
     */
    if (
        ![
            "status",
            "players",
            "start",
            "stop",
            "restart",
            "server"
        ].includes(commandName)
    ) {
        return;
    }

    const serverId =
        interaction.options.getString("server");

    const server =
        getServer(serverId);

    if (!server) {

        await interaction.reply({
            content: "❌ Minecraft server not found.",
            ephemeral: true
        });

        return;
    }

    /*
     * Coming Soon
     */
    if (isComingSoon(server)) {

        await interaction.reply({
            embeds: [
                buildComingSoonEmbed(server)
            ],
            ephemeral: true
        });

        return;
    }

    /*
     * /status
     */
    if (commandName === "status") {

        await interaction.deferReply();

        try {

            const status =
                await getServerStatus(server);

            await interaction.editReply({
                embeds: [
                    buildServerEmbed(
                        server,
                        status
                    )
                ]
            });

        } catch (error) {

            await interaction.editReply(
                `❌ Failed to check **${server.name}**.\n` +
                `\`${error.message}\``
            );
        }

        return;
    }

    /*
     * /players
     */
    if (commandName === "players") {

        await interaction.deferReply();

        try {

            const status =
                await getServerStatus(server);

            if (!status.online) {

                await interaction.editReply(
                    `🔴 **${server.name}** is offline.`
                );

                return;
            }

            if (
                !status.players ||
                status.players.length === 0
            ) {

                await interaction.editReply(
                    `🟢 **${server.name}** is online, but nobody is playing.`
                );

                return;
            }

            const playerList =
                status.players
                    .map(player => `• ${player}`)
                    .join("\n");

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        `👥 ${server.emoji || "🖥️"} ${server.name} Players`
                    )
                    .setDescription(
                        playerList.substring(0, 4096)
                    )
                    .addFields({
                        name: "Players",
                        value:
                            `${status.playerCount}/${status.maxPlayers}`,
                        inline: true
                    })
                    .setTimestamp();

            await interaction.editReply({
                embeds: [embed]
            });

        } catch (error) {

            await interaction.editReply(
                `❌ Failed to get players from **${server.name}**.\n` +
                `\`${error.message}\``
            );
        }

        return;
    }

    /*
     * Admin commands
     */
    if (!isAdmin(interaction)) {

        await interaction.reply({
            content:
                "❌ You need **Administrator** permission to use this command.",
            ephemeral: true
        });

        return;
    }

    /*
     * Make sure a systemd service exists.
     */
    if (
        [
            "start",
            "stop",
            "restart"
        ].includes(commandName) &&
        !server.systemdService
    ) {

        await interaction.reply({
            content:
                `❌ **${server.name}** does not have a systemd service configured.`,
            ephemeral: true
        });

        return;
    }

    /*
     * /start
     */
    if (commandName === "start") {

        await interaction.deferReply({
            ephemeral: true
        });

        const {
            exec
        } = require("child_process");

        exec(
            `sudo systemctl start ${server.systemdService}`,
            async error => {

                if (error) {

                    await interaction.editReply(
                        `❌ Failed to start **${server.name}**.\n` +
                        `\`${error.message}\``
                    );

                    return;
                }

                await interaction.editReply(
                    `🟢 Starting **${server.name}**...`
                );
            }
        );

        return;
    }

    /*
     * /stop
     */
    if (commandName === "stop") {

        await interaction.deferReply({
            ephemeral: true
        });

        const {
            exec
        } = require("child_process");

        exec(
            `sudo systemctl stop ${server.systemdService}`,
            async error => {

                if (error) {

                    await interaction.editReply(
                        `❌ Failed to stop **${server.name}**.\n` +
                        `\`${error.message}\``
                    );

                    return;
                }

                await interaction.editReply(
                    `🔴 Stopping **${server.name}**...`
                );
            }
        );

        return;
    }

    /*
     * /restart
     */
    if (commandName === "restart") {

        await interaction.deferReply({
            ephemeral: true
        });

        const {
            exec
        } = require("child_process");

        exec(
            `sudo systemctl restart ${server.systemdService}`,
            async error => {

                if (error) {

                    await interaction.editReply(
                        `❌ Failed to restart **${server.name}**.\n` +
                        `\`${error.message}\``
                    );

                    return;
                }

                await interaction.editReply(
                    `🔄 Restarting **${server.name}**...`
                );
            }
        );

        return;
    }

    /*
     * /server command
     */
    if (commandName === "server") {

        const command =
            interaction.options.getString("command");

        await interaction.deferReply({
            ephemeral: true
        });

        const result =
            await executeRcon(
                server,
                command
            );

        if (!result.online) {

            await interaction.editReply(
                `🔴 **${server.name}** is offline or RCON is unavailable.\n\n` +
                `Error: \`${result.error || "Unknown error"}\``
            );

            return;
        }

        let response =
            result.response ||
            "Command executed successfully.";

        if (response.length > 1800) {

            response =
                response.substring(0, 1800) +
                "\n...";
        }

        await interaction.editReply(
            `🖥️ **${server.name}**\n\n` +
            `\`\`\`\n${response}\n\`\`\``
        );

        return;
    }
}

module.exports = {
    commands,
    handleCommand
};
