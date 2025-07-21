require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// Initialize Express server for Render hosting
const app = express();
app.get('/', (req, res) => {
    res.send('Discord Giveaway Bot is alive! 🎉');
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Keepalive server running on 0.0.0.0:${port}`);
});

// Discord Bot Configuration
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const ROLES = {
    GIVEAWAY: '1396583158815789106',   // giveaway role
    AUTHORIZED: [
        '1392125837586989067',
        '1392126513612062770', 
        '1396269951404474538'
    ]
};

// Data storage
let activeGiveaways = new Map();
let globalImage = null;
let giveawayCounter = 0;

// File paths
const DATA_DIR = './data';
const files = {
    giveaways: path.join(DATA_DIR, 'giveaways.json'),
    globalImage: path.join(DATA_DIR, 'globalImage.json'),
    counter: path.join(DATA_DIR, 'counter.json')
};

// Ensure data directory and files exist
async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        for (const file of Object.values(files)) {
            try {
                await fs.access(file);
            } catch {
                await fs.writeFile(file, JSON.stringify(file.includes('giveaways') ? [] : { counter: 0, globalImage: null }, null, 2));
                console.log(`Created empty ${file}`);
            }
        }
    } catch (error) {
        console.error('Error creating data directory or files:', error);
    }
}

// Save data functions
async function saveData() {
    try {
        await ensureDataDir();
        await fs.writeFile(files.giveaways, JSON.stringify(Array.from(activeGiveaways.entries()), null, 2));
        await fs.writeFile(files.globalImage, JSON.stringify({ globalImage }, null, 2));
        await fs.writeFile(files.counter, JSON.stringify({ counter: giveawayCounter }, null, 2));
        console.log('Data saved successfully');
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

// Load data functions
async function loadData() {
    try {
        await ensureDataDir();
        
        try {
            const giveawaysData = await fs.readFile(files.giveaways, 'utf8');
            activeGiveaways = new Map(JSON.parse(giveawaysData || '[]'));
            console.log(`Loaded ${activeGiveaways.size} giveaways`);
        } catch (error) {
            console.log('No existing giveaways data found, starting fresh');
            activeGiveaways = new Map();
        }

        try {
            const imageData = await fs.readFile(files.globalImage, 'utf8');
            globalImage = JSON.parse(imageData || '{}').globalImage;
            console.log(globalImage ? 'Global image loaded' : 'No global image set');
        } catch (error) {
            console.log('No global image data found');
        }

        try {
            const counterData = await fs.readFile(files.counter, 'utf8');
            giveawayCounter = JSON.parse(counterData || '{}').counter || 0;
            console.log(`Giveaway counter set to ${giveawayCounter}`);
        } catch (error) {
            console.log('No counter data found, starting at 0');
            giveawayCounter = 0;
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// Check if user has authorized roles
function hasAuthorizedRole(member) {
    return ROLES.AUTHORIZED.some(roleId => member.roles.cache.has(roleId));
}

// Utility functions
function parseTime(timeStr) {
    const regex = /(\d+)\s*([hmsd])/gi;
    let totalMs = 0;
    let match;

    while ((match = regex.exec(timeStr)) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        
        switch (unit) {
            case 's': totalMs += value * 1000; break;
            case 'm': totalMs += value * 60 * 1000; break;
            case 'h': totalMs += value * 60 * 60 * 1000; break;
            case 'd': totalMs += value * 24 * 60 * 60 * 1000; break;
        }
    }
    
    return totalMs;
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[i], shuffled[j]];
    }
    return shuffled;
}

// Create giveaway embed
function createGiveawayEmbed(giveaway) {
    const embed = new EmbedBuilder()
        .setTitle(`🎁 ${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}`)
        .setColor(0x00ff00)
        .addFields(
            { name: '⏰ Duration', value: formatDuration(giveaway.duration), inline: true },
            { name: '👑 Winners', value: giveaway.winners.toString(), inline: true },
            { name: '🙋 Participants', value: giveaway.participants.length.toString(), inline: true }
        )
        .setFooter({ text: `This giveaway is only valid if at least ${giveaway.minParticipants} users participate.` })
        .setTimestamp();

    if (globalImage) {
        embed.setImage(globalImage);
    }

    return embed;
}

// Create winner embed for DM
function createWinnerDMEmbed(giveaway, allWinners) {
    const embed = new EmbedBuilder()
        .setTitle('🏆 WINNER!')
        .setColor(0xffd700)
        .addFields(
            { name: '🎁 Item', value: `${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}`, inline: false },
            { name: '👑 Winners', value: allWinners.map(id => `<@${id}>`).join(', '), inline: false },
            { name: '⏰ Giveaway Duration', value: formatDuration(giveaway.duration), inline: false },
            { name: '📬 Next Steps', value: `Please open a ticket in this channel: <#${giveaway.channelId || '1393431028562919434'}>\nand mention that you won to claim your item.`, inline: false }
        )
        .setTimestamp();

    if (globalImage) {
        embed.setImage(globalImage);
    }

    return embed;
}

// Create public winner announcement embed
function createWinnerAnnouncementEmbed(giveaway, winners) {
    const embed = new EmbedBuilder()
        .setTitle('🏆 WINNER!')
        .setColor(0xffd700)
        .addFields(
            { name: '🎁 Item', value: `${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}`, inline: false },
            { name: '⏰ Duration', value: formatDuration(giveaway.duration), inline: false },
            { name: '👑 Winners', value: winners.map(id => `<@${id}>`).join(', '), inline: false }
        )
        .setTimestamp();

    if (globalImage) {
        embed.setImage(globalImage);
    }

    return embed;
}

// End giveaway function
async function endGiveaway(giveawayId) {
    const giveaway = activeGiveaways.get(giveawayId);
    if (!giveaway) {
        console.log(`Giveaway ${giveawayId} not found for ending`);
        return;
    }

    try {
        const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
        if (!channel) {
            console.error(`Giveaway channel ${giveaway.channelId} not found`);
            return;
        }

        const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
        if (!message) {
            console.error(`Message ${giveaway.messageId} not found in giveaway channel`);
            return;
        }

        if (giveaway.participants.length < giveaway.minParticipants) {
            // Cancel giveaway - not enough participants
            const cancelEmbed = new EmbedBuilder()
                .setTitle('❌ Giveaway Cancelled')
                .setDescription(`**${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}** was cancelled.\nThe required minimum of ${giveaway.minParticipants} participants was not reached. ${giveaway.participants.length} users participated.`)
                .setColor(0xff0000)
                .setTimestamp();

            await message.edit({ 
                embeds: [cancelEmbed], 
                components: [] 
            });

            // Send cancellation message to announcements with participant mention
            const announcementChannel = await client.channels.fetch('1392122107390857266').catch(() => null); // Fixed ID for now
            if (announcementChannel) {
                const participantMentions = giveaway.participants.slice(0, 10).map(id => `<@${id}>`).join(', ') || 'No participants';
                const moreParticipants = giveaway.participants.length > 10 ? `, and ${giveaway.participants.length - 10} more` : '';

                await announcementChannel.send({
                    content: `<@&${ROLES.GIVEAWAY}>`,
                    embeds: [new EmbedBuilder()
                        .setTitle('❌ Giveaway Cancelled')
                        .setDescription(`Unfortunately, the giveaway **${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}** was cancelled.\nThe required minimum of ${giveaway.minParticipants} participants was not reached. Participants: ${participantMentions}${moreParticipants}.\nWe’re sorry to those who joined. A new giveaway will be available soon!`)
                        .setColor(0xff0000)
                        .setTimestamp()
                    ]
                });
            } else {
                console.error(`Announcement channel not found`);
            }

        } else {
            // Select winners
            const shuffledParticipants = shuffleArray(giveaway.participants);
            const winners = shuffledParticipants.slice(0, Math.min(giveaway.winners, giveaway.participants.length));

            // Update original message to show it ended
            const endedEmbed = new EmbedBuilder()
                .setTitle(`🏆 ${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''} - ENDED`)
                .setColor(0xffd700)
                .addFields(
                    { name: '⏰ Duration', value: formatDuration(giveaway.duration), inline: true },
                    { name: '👑 Winners', value: winners.length > 0 ? winners.map(id => `<@${id}>`).join(', ') : 'No winners', inline: false },
                    { name: '🙋 Final Participants', value: giveaway.participants.length.toString(), inline: true }
                )
                .setTimestamp();

            if (globalImage) {
                endedEmbed.setImage(globalImage);
            }

            await message.edit({ 
                embeds: [endedEmbed], 
                components: [] 
            });

            // Send DMs to winners
            for (const winnerId of winners) {
                try {
                    const user = await client.users.fetch(winnerId);
                    const dmEmbed = createWinnerDMEmbed(giveaway, winners);
                    await user.send({ embeds: [dmEmbed] });
                    console.log(`Sent winner DM to ${winnerId}`);
                } catch (error) {
                    console.error(`Failed to send DM to winner ${winnerId}:`, error);
                }
            }

            // Post public winner announcement
            const winnersChannel = await client.channels.fetch('1396578011834355952').catch(() => null); // Fixed ID for now
            if (winnersChannel) {
                const announcementEmbed = createWinnerAnnouncementEmbed(giveaway, winners);
                await winnersChannel.send({ embeds: [announcementEmbed] });
            } else {
                console.error(`Winners channel not found`);
            }
        }

        activeGiveaways.delete(giveawayId);
        await saveData();
        console.log(`Giveaway ${giveawayId} ended successfully`);

    } catch (error) {
        console.error(`Error ending giveaway ${giveawayId}:`, error);
    }
}

// Slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('creategiveaway')
        .setDescription('Create a new giveaway using a modal'),

    new SlashCommandBuilder()
        .setName('globalimage')
        .setDescription('Set global image for giveaways')
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Image to use for all giveaways')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('editgiveaway')
        .setDescription('Edit an active giveaway')
        .addStringOption(option =>
            option.setName('giveaway')
                .setDescription('Giveaway ID or item name')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('item')
                .setDescription('New item name')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('quantity')
                .setDescription('New quantity')
                .setRequired(false)
                .setMinValue(1))
        .addIntegerOption(option =>
            option.setName('winners')
                .setDescription('New number of winners')
                .setRequired(false)
                .setMinValue(1)),

    new SlashCommandBuilder()
        .setName('editgmessage')
        .setDescription('Edit the minimum participants message')
        .addStringOption(option =>
            option.setName('giveaway')
                .setDescription('Giveaway ID or item name')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('minparticipants')
                .setDescription('New minimum participants required')
                .setRequired(true)
                .setMinValue(1)),

    new SlashCommandBuilder()
        .setName('listparticipants')
        .setDescription('List all participants of a giveaway')
        .addStringOption(option =>
            option.setName('giveaway')
                .setDescription('Giveaway ID or item name')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available commands')
];

// Register slash commands
async function registerCommands() {
    try {
        if (!process.env.CLIENT_ID || !process.env.DISCORD_TOKEN) {
            throw new Error('CLIENT_ID or DISCORD_TOKEN is not defined in environment variables');
        }
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Bot ready event
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    await loadData();
    await registerCommands();
    
    try {
        const guild = client.guilds.cache.first();
        await guild.roles.fetch(ROLES.GIVEAWAY);
        console.log(`Role GIVEAWAY (${ROLES.GIVEAWAY}) validated`);
        for (const roleId of ROLES.AUTHORIZED) {
            await guild.roles.fetch(roleId);
            console.log(`Authorized role (${roleId}) validated`);
        }
    } catch {
        console.error('One or more roles not found or inaccessible');
    }

    // Resume active giveaway timers
    for (const [id, giveaway] of activeGiveaways) {
        const timeLeft = giveaway.endTime - Date.now();
        if (timeLeft > 0) {
            console.log(`Resuming giveaway ${id} with ${formatDuration(timeLeft)} remaining`);
            setTimeout(() => endGiveaway(id), timeLeft);
        } else {
            console.log(`Ending expired giveaway ${id} immediately`);
            await endGiveaway(id);
        }
    }
});

// Interaction handling
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;

            // Check authorization for all commands except help
            if (commandName !== 'help') {
                if (!interaction.member) {
                    return interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
                }

                if (!hasAuthorizedRole(interaction.member)) {
                    return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
                }
            }

            if (commandName === 'creategiveaway') {
                // Initial modal to guide the user
                const modal = new ModalBuilder()
                    .setCustomId('initGiveawayModal')
                    .setTitle('Initialize New Giveaway');

                const guideInput = new TextInputBuilder()
                    .setCustomId('guideInput')
                    .setLabel('Select a channel in the next step')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setValue('Please confirm to proceed and choose a channel below.');

                const firstRow = new ActionRowBuilder().addComponents(guideInput);
                modal.addComponents(firstRow);

                await interaction.showModal(modal);

            } else if (commandName === 'globalimage') {
                const attachment = interaction.options.getAttachment('image');
                
                if (!attachment.contentType?.startsWith('image/')) {
                    return interaction.reply({ content: '❌ Please upload a valid image file.', ephemeral: true });
                }

                globalImage = attachment.url;
                await saveData();

                const embed = new EmbedBuilder()
                    .setTitle('✅ Global Image Updated')
                    .setDescription('This image will now be used in all giveaway embeds.')
                    .setImage(globalImage)
                    .setColor(0x00ff00);

                await interaction.reply({ embeds: [embed], ephemeral: true });

            } else if (commandName === 'editgiveaway') {
                const giveawayQuery = interaction.options.getString('giveaway');
                const newItem = interaction.options.getString('item');
                const newQuantity = interaction.options.getInteger('quantity');
                const newWinners = interaction.options.getInteger('winners');

                let giveaway = activeGiveaways.get(giveawayQuery);
                if (!giveaway) {
                    giveaway = Array.from(activeGiveaways.values()).find(g => g.item.toLowerCase().includes(giveawayQuery.toLowerCase()));
                }

                if (!giveaway) {
                    return interaction.reply({ content: '❌ Giveaway not found.', ephemeral: true });
                }

                if (newItem) giveaway.item = newItem;
                if (newQuantity) giveaway.quantity = newQuantity;
                if (newWinners) giveaway.winners = newWinners;

                const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
                if (!channel) {
                    return interaction.reply({ content: `❌ Giveaway channel (${giveaway.channelId}) not found.`, ephemeral: true });
                }

                const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
                if (!message) {
                    return interaction.reply({ content: `❌ Giveaway message not found.`, ephemeral: true });
                }

                const updatedEmbed = createGiveawayEmbed(giveaway);
                await message.edit({ embeds: [updatedEmbed] });
                await saveData();

                await interaction.reply({ content: '✅ Giveaway updated successfully!', ephemeral: true });

            } else if (commandName === 'editgmessage') {
                const giveawayQuery = interaction.options.getString('giveaway');
                const newMinParticipants = interaction.options.getInteger('minparticipants');

                let giveaway = activeGiveaways.get(giveawayQuery);
                if (!giveaway) {
                    giveaway = Array.from(activeGiveaways.values()).find(g => g.item.toLowerCase().includes(giveawayQuery.toLowerCase()));
                }

                if (!giveaway) {
                    return interaction.reply({ content: '❌ Giveaway not found.', ephemeral: true });
                }

                giveaway.minParticipants = newMinParticipants;

                const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
                if (!channel) {
                    return interaction.reply({ content: `❌ Giveaway channel (${giveaway.channelId}) not found.`, ephemeral: true });
                }

                const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
                if (!message) {
                    return interaction.reply({ content: `❌ Giveaway message not found.`, ephemeral: true });
                }

                const updatedEmbed = createGiveawayEmbed(giveaway);
                await message.edit({ embeds: [updatedEmbed] });
                await saveData();

                await interaction.reply({ content: '✅ Minimum participants message updated!', ephemeral: true });

            } else if (commandName === 'listparticipants') {
                const giveawayQuery = interaction.options.getString('giveaway');

                let giveaway = activeGiveaways.get(giveawayQuery);
                if (!giveaway) {
                    giveaway = Array.from(activeGiveaways.values()).find(g => g.item.toLowerCase().includes(giveawayQuery.toLowerCase()));
                }

                if (!giveaway) {
                    return interaction.reply({ content: '❌ Giveaway not found.', ephemeral: true });
                }

                if (giveaway.participants.length === 0) {
                    const noParticipantsEmbed = new EmbedBuilder()
                        .setTitle('📋 Participants List')
                        .setDescription(`**Giveaway**: ${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}\n\n❌ No participants yet.`)
                        .setColor(0xff9900)
                        .setTimestamp();

                    return interaction.reply({ embeds: [noParticipantsEmbed], ephemeral: true });
                }

                const participantChunks = [];
                let currentChunk = '';
                
                for (let i = 0; i < giveaway.participants.length; i++) {
                    const participant = `${i + 1}. <@${giveaway.participants[i]}>\n`;
                    
                    if (currentChunk.length + participant.length > 1000) {
                        participantChunks.push(currentChunk);
                        currentChunk = participant;
                    } else {
                        currentChunk += participant;
                    }
                }
                
                if (currentChunk) {
                    participantChunks.push(currentChunk);
                }

                const participantsEmbed = new EmbedBuilder()
                    .setTitle('📋 Participants List')
                    .setDescription(`**Giveaway**: ${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}\n**Total Participants**: ${giveaway.participants.length}\n**Minimum Required**: ${giveaway.minParticipants}`)
                    .setColor(0x00ff00)
                    .setTimestamp();

                participantChunks.slice(0, 5).forEach((chunk, index) => {
                    participantsEmbed.addFields({
                        name: index === 0 ? '👥 Participants' : `👥 Participants (cont'd ${index + 1})`,
                        value: chunk,
                        inline: false
                    });
                });

                if (participantChunks.length > 5) {
                    participantsEmbed.setFooter({ text: `... and ${giveaway.participants.length - (participantChunks.slice(0, 5).join('').match(/\n/g) || []).length} more participants` });
                }

                await interaction.reply({ embeds: [participantsEmbed], ephemeral: true });

            } else if (commandName === 'help') {
                const helpEmbed = new EmbedBuilder()
                    .setTitle('🎉 Giveaway Bot Commands')
                    .setColor(0x00ff00)
                    .addFields(
                        { name: '/creategiveaway', value: 'Create a new giveaway using a modal', inline: false },
                        { name: '/globalimage', value: 'Set a global image that will be used in all giveaway embeds', inline: false },
                        { name: '/editgiveaway', value: 'Edit an active giveaway by ID or item name', inline: false },
                        { name: '/editgmessage', value: 'Update the minimum participants requirement message', inline: false },
                        { name: '/listparticipants', value: 'Show the list of all participants in a giveaway', inline: false },
                        { name: '/help', value: 'Show this help message', inline: false }
                    )
                    .setFooter({ text: 'Giveaways are posted in the selected channel and winners announced in #🏆┃winners' })
                    .setTimestamp();

                if (interaction.member && hasAuthorizedRole(interaction.member)) {
                    helpEmbed.setDescription('📋 **Available Commands** (You have admin access)');
                } else {
                    helpEmbed.setDescription('📋 **Available Commands** (Most commands require special permissions)');
                }

                await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
            }

        } else if (interaction.isModalSubmit() && interaction.customId === 'initGiveawayModal') {
            await interaction.deferReply({ ephemeral: true });

            const guild = interaction.guild;
            const channels = await guild.channels.fetch();
            const textChannels = channels.filter(channel => channel.type === 0 && channel.permissionsFor(interaction.user).has('SEND_MESSAGES'));

            const channelSelect = new StringSelectMenuBuilder()
                .setCustomId('channelSelect')
                .setPlaceholder('Choose a channel for the giveaway')
                .addOptions(
                    textChannels.map(channel => ({
                        label: channel.name,
                        description: `Channel: #${channel.name}`,
                        value: channel.id,
                    }))
                );

            const row = new ActionRowBuilder().addComponents(channelSelect);

            await interaction.editReply({
                content: 'Please select the channel for your giveaway:',
                components: [row],
                ephemeral: true
            });

        } else if (interaction.isStringSelectMenu() && interaction.customId === 'channelSelect') {
            const channelId = interaction.values[0];
            const channel = await interaction.guild.channels.fetch(channelId);

            if (!channel || channel.type !== 0 || !channel.permissionsFor(interaction.user).has('SEND_MESSAGES')) {
                return interaction.update({ content: '❌ Invalid channel selection or insufficient permissions.', components: [] });
            }

            const modal = new ModalBuilder()
                .setCustomId('createGiveawayModal')
                .setTitle('Create a New Giveaway');

            const itemInput = new TextInputBuilder()
                .setCustomId('itemInput')
                .setLabel('Item to Giveaway')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const quantityInput = new TextInputBuilder()
                .setCustomId('quantityInput')
                .setLabel('Quantity')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const winnersInput = new TextInputBuilder()
                .setCustomId('winnersInput')
                .setLabel('Number of Winners')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const durationInput = new TextInputBuilder()
                .setCustomId('durationInput')
                .setLabel('Duration (e.g., 1h 30m, 2d 4h)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const minParticipantsInput = new TextInputBuilder()
                .setCustomId('minParticipantsInput')
                .setLabel('Minimum Participants (optional)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            const firstRow = new ActionRowBuilder().addComponents(itemInput);
            const secondRow = new ActionRowBuilder().addComponents(quantityInput);
            const thirdRow = new ActionRowBuilder().addComponents(winnersInput);
            const fourthRow = new ActionRowBuilder().addComponents(durationInput);
            const fifthRow = new ActionRowBuilder().addComponents(minParticipantsInput);

            modal.addComponents(firstRow, secondRow, thirdRow, fourthRow, fifthRow);

            await interaction.showModal(modal);

        } else if (interaction.isModalSubmit() && interaction.customId === 'createGiveawayModal') {
            const item = interaction.fields.getTextInputValue('itemInput');
            const quantity = parseInt(interaction.fields.getTextInputValue('quantityInput'));
            const winners = parseInt(interaction.fields.getTextInputValue('winnersInput'));
            const durationStr = interaction.fields.getTextInputValue('durationInput');
            const minParticipants = interaction.fields.getTextInputValue('minParticipantsInput') ? parseInt(interaction.fields.getTextInputValue('minParticipantsInput')) : 3;

            if (isNaN(quantity) || quantity < 1) {
                return interaction.reply({ content: '❌ Quantity must be a positive number.', ephemeral: true });
            }
            if (isNaN(winners) || winners < 1) {
                return interaction.reply({ content: '❌ Number of winners must be a positive number.', ephemeral: true });
            }
            const duration = parseTime(durationStr);
            if (duration === 0) {
                return interaction.reply({ content: '❌ Invalid duration format. Use formats like "1h 30m" or "2d 4h".', ephemeral: true });
            }
            if (minParticipants && (isNaN(minParticipants) || minParticipants < 1)) {
                return interaction.reply({ content: '❌ Minimum participants must be a positive number.', ephemeral: true });
            }

            const channelId = interaction.message.interaction?.message?.components[0]?.components[0]?.data?.options?.find(opt => opt.default)?.value;
            if (!channelId) {
                return interaction.reply({ content: '❌ Channel selection is missing. Please restart the command.', ephemeral: true });
            }

            giveawayCounter++;
            const giveawayId = `giveaway-${giveawayCounter}`;
            const endTime = Date.now() + duration;

            const giveaway = {
                id: giveawayId,
                item,
                quantity,
                winners,
                duration,
                endTime,
                participants: [],
                minParticipants,
                createdBy: interaction.user.id,
                createdAt: Date.now(),
                channelId: channelId
            };

            const embed = createGiveawayEmbed(giveaway);
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`participate_${giveawayId}`)
                        .setLabel('🎉 Participate')
                        .setStyle(ButtonStyle.Primary)
                );

            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) {
                return interaction.reply({ content: '❌ The specified channel was not found or is inaccessible.', ephemeral: true });
            }

            const message = await channel.send({ embeds: [embed], components: [row] });
            
            giveaway.messageId = message.id;
            activeGiveaways.set(giveawayId, giveaway);
            await saveData();

            setTimeout(() => endGiveaway(giveawayId), duration);

            await interaction.reply({ content: `✅ Giveaway created! ID: \`${giveawayId}\``, ephemeral: true });

        } else if (interaction.isButton()) {
            if (interaction.customId.startsWith('participate_')) {
                const giveawayId = interaction.customId.split('_')[1];
                const giveaway = activeGiveaways.get(giveawayId);

                if (!giveaway) {
                    return interaction.reply({ content: '❌ This giveaway is no longer active.', ephemeral: true });
                }

                if (giveaway.participants.includes(interaction.user.id)) {
                    return interaction.reply({ content: '❌ You are already participating in this giveaway!', ephemeral: true });
                }

                giveaway.participants.push(interaction.user.id);
                await saveData();

                const updatedEmbed = createGiveawayEmbed(giveaway);
                await interaction.update({ embeds: [updatedEmbed] });

                try {
                    const confirmEmbed = new EmbedBuilder()
                        .setTitle('✅ Participation Confirmed')
                        .setDescription(`You are now participating in the giveaway for **${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}**!`)
                        .setColor(0x00ff00)
                        .setTimestamp();

                    await interaction.user.send({ embeds: [confirmEmbed] });
                    console.log(`Sent participation confirmation DM to ${interaction.user.tag}`);
                } catch (error) {
                    console.error(`Could not send confirmation DM to ${interaction.user.tag}:`, error);
                }
            }
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ An error occurred while processing your request.', ephemeral: true });
        }
    }
});

// Error handling
client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

(async () => {
    if (!process.env.DISCORD_TOKEN) {
        console.error('Error: DISCORD_TOKEN is not defined in environment variables');
        process.exit(1);
    }
    if (!process.env.CLIENT_ID) {
        console.error('Error: CLIENT_ID is not defined in environment variables');
        process.exit(1);
    }

    try {
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('Error logging in:', error);
        process.exit(1);
    }
})();
