const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelType } = require('discord.js');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// Initialize Express server for Render hosting
const app = express();
app.get('/', (req, res) => {
    res.send('Discord Giveaway Bot is alive! 🎉');
});

app.listen(3000, '0.0.0.0', () => {
    console.log('Keepalive server running on 0.0.0.0:3000');
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

// Channel IDs from specification
const CHANNELS = {
    GIVEAWAYS: '1393431028562919434', // 🎉┃giveaways
    WINNERS: '1396578011834355952',   // 🏆┃winners  
    ANNOUNCEMENTS: '1392122107390857266', // announcement channel
    TICKETS: '1393431028562919434'    // ticket channel
};

const ROLES = {
    GIVEAWAY: '1396583158815789106'   // giveaway role
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

// Ensure data directory exists
async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating data directory:', error);
    }
}

// Save data functions
async function saveData() {
    try {
        await ensureDataDir();
        await fs.writeFile(files.giveaways, JSON.stringify(Array.from(activeGiveaways.entries()), null, 2));
        await fs.writeFile(files.globalImage, JSON.stringify({ globalImage }, null, 2));
        await fs.writeFile(files.counter, JSON.stringify({ counter: giveawayCounter }, null, 2));
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

// Load data functions
async function loadData() {
    try {
        await ensureDataDir();
        
        // Load giveaways
        try {
            const giveawaysData = await fs.readFile(files.giveaways, 'utf8');
            activeGiveaways = new Map(JSON.parse(giveawaysData));
        } catch (error) {
            console.log('No existing giveaways data found, starting fresh');
        }

        // Load global image
        try {
            const imageData = await fs.readFile(files.globalImage, 'utf8');
            globalImage = JSON.parse(imageData).globalImage;
        } catch (error) {
            console.log('No global image set');
        }

        // Load counter
        try {
            const counterData = await fs.readFile(files.counter, 'utf8');
            giveawayCounter = JSON.parse(counterData).counter;
        } catch (error) {
            giveawayCounter = 0;
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
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
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
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
            { name: '📬 Next Steps', value: `Please open a ticket in this channel: <#${CHANNELS.TICKETS}>\nand mention that you won to claim your item.`, inline: false }
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
    if (!giveaway) return;

    try {
        const channel = await client.channels.fetch(CHANNELS.GIVEAWAYS);
        const message = await channel.messages.fetch(giveaway.messageId);

        if (giveaway.participants.length < giveaway.minParticipants) {
            // Cancel giveaway - not enough participants
            const cancelEmbed = new EmbedBuilder()
                .setTitle('❌ Giveaway Cancelled')
                .setDescription(`**${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}** was cancelled.\nThe required minimum number of participants was not reached.`)
                .setColor(0xff0000)
                .setTimestamp();

            await message.edit({ 
                embeds: [cancelEmbed], 
                components: [] 
            });

            // Prepare participant mentions for announcement
            const participantMentions = giveaway.participants.slice(0, 10).map(id => `<@${id}>`).join(', ');
            const moreParticipants = giveaway.participants.length > 10 ? ` and ${giveaway.participants.length - 10} more` : '';
            const participantText = giveaway.participants.length > 0 
                ? `\n\n**Participants (${giveaway.participants.length})**: ${participantMentions}${moreParticipants}`
                : '';

            // Send cancellation message to announcements
            const announcementChannel = await client.channels.fetch(CHANNELS.ANNOUNCEMENTS);
            await announcementChannel.send({
                content: `<@&${ROLES.GIVEAWAY}>`,
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Giveaway Cancelled')
                    .setDescription(`Unfortunately, the giveaway **${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}** was cancelled.\nThe required minimum number of participants was not reached.\n\nWe're sorry to those who joined. A new giveaway will be available soon!${participantText}`)
                    .setColor(0xff0000)
                    .setTimestamp()
                ]
            });

        } else {
            // Select winners
            const shuffledParticipants = shuffleArray(giveaway.participants);
            const winners = shuffledParticipants.slice(0, giveaway.winners);

            // Update original message to show it ended
            const endedEmbed = new EmbedBuilder()
                .setTitle(`🏆 ${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''} - ENDED`)
                .setColor(0xffd700)
                .addFields(
                    { name: '⏰ Duration', value: formatDuration(giveaway.duration), inline: true },
                    { name: '👑 Winners', value: winners.map(id => `<@${id}>`).join(', '), inline: false },
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
                } catch (error) {
                    console.error(`Failed to send DM to winner ${winnerId}:`, error);
                }
            }

            // Post public winner announcement
            const winnersChannel = await client.channels.fetch(CHANNELS.WINNERS);
            const announcementEmbed = createWinnerAnnouncementEmbed(giveaway, winners);
            await winnersChannel.send({ embeds: [announcementEmbed] });
        }

        activeGiveaways.delete(giveawayId);
        await saveData();

    } catch (error) {
        console.error('Error ending giveaway:', error);
    }
}

// Slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('creategiveaway')
        .setDescription('Create a new giveaway with channel selection'),

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
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
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
    
    // Resume active giveaway timers
    for (const [id, giveaway] of activeGiveaways) {
        const timeLeft = giveaway.endTime - Date.now();
        if (timeLeft > 0) {
            setTimeout(() => endGiveaway(id), timeLeft);
        } else {
            // Giveaway should have ended, end it now
            endGiveaway(id);
        }
    }
});

// Interaction handling
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'creategiveaway') {
            // Create initial modal with channel selection instruction
            const initModal = new ModalBuilder()
                .setCustomId('init_giveaway_modal')
                .setTitle('Create Giveaway - Step 1');

            const instructionInput = new TextInputBuilder()
                .setCustomId('instruction')
                .setLabel('Instructions')
                .setStyle(TextInputStyle.Paragraph)
                .setValue('Next, you will select the channel where the giveaway will be posted.\nClick Submit to continue to channel selection.')
                .setRequired(false);

            const instructionRow = new ActionRowBuilder().addComponents(instructionInput);
            initModal.addComponents(instructionRow);

            await interaction.showModal(initModal);

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
                // Try to find by item name
                giveaway = Array.from(activeGiveaways.values()).find(g => g.item.toLowerCase().includes(giveawayQuery.toLowerCase()));
            }

            if (!giveaway) {
                return interaction.reply({ content: '❌ Giveaway not found.', ephemeral: true });
            }

            if (newItem) giveaway.item = newItem;
            if (newQuantity) giveaway.quantity = newQuantity;
            if (newWinners) giveaway.winners = newWinners;

            // Update the message
            const channel = await client.channels.fetch(CHANNELS.GIVEAWAYS);
            const message = await channel.messages.fetch(giveaway.messageId);
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

            // Update the message
            const channel = await client.channels.fetch(CHANNELS.GIVEAWAYS);
            const message = await channel.messages.fetch(giveaway.messageId);
            const updatedEmbed = createGiveawayEmbed(giveaway);
            
            await message.edit({ embeds: [updatedEmbed] });
            await saveData();

            await interaction.reply({ content: '✅ Minimum participants message updated!', ephemeral: true });

        } else if (commandName === 'listparticipants') {
            const giveawayQuery = interaction.options.getString('giveaway');

            let giveaway = activeGiveaways.get(giveawayQuery);
            if (!giveaway) {
                // Try to find by item name
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

            // Create chunks of participants (Discord embed field limit is 1024 characters)
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

            // Add participant fields (max 25 fields per embed)
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
                    { name: '/creategiveaway', value: 'Create a new giveaway with interactive channel selection', inline: false },
                    { name: '/globalimage', value: 'Set a global image that will be used in all giveaway embeds', inline: false },
                    { name: '/editgiveaway', value: 'Edit an active giveaway by ID or item name', inline: false },
                    { name: '/editgmessage', value: 'Update the minimum participants requirement message', inline: false },
                    { name: '/listparticipants', value: 'Show the list of all participants in a giveaway', inline: false },
                    { name: '/help', value: 'Show this help message', inline: false }
                )
                .setFooter({ text: 'All giveaways are posted in #🎉┃giveaways and winners announced in #🏆┃winners' })
                .setTimestamp();

            await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
        }

    } else if (interaction.isModalSubmit()) {
        if (interaction.customId === 'init_giveaway_modal') {
            // Show channel selection menu
            try {
                const guild = interaction.guild;
                const channels = await guild.channels.fetch();
                const textChannels = channels
                    .filter(channel => channel.type === ChannelType.GuildText && 
                            channel.permissionsFor(interaction.user).has(PermissionFlagsBits.ViewChannel))
                    .sort((a, b) => a.position - b.position)
                    .first(25); // Discord select menu limit

                if (textChannels.size === 0) {
                    return interaction.reply({ 
                        content: '❌ No accessible text channels found.', 
                        ephemeral: true 
                    });
                }

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('channel_select')
                    .setPlaceholder('Select the channel for the giveaway')
                    .addOptions(
                        textChannels.map(channel => ({
                            label: `# ${channel.name}`,
                            description: `Channel ID: ${channel.id}`,
                            value: channel.id
                        }))
                    );

                const selectRow = new ActionRowBuilder().addComponents(selectMenu);

                const selectEmbed = new EmbedBuilder()
                    .setTitle('🎯 Select Channel')
                    .setDescription('Choose the channel where you want to post the giveaway:')
                    .setColor(0x00ff00)
                    .setTimestamp();

                await interaction.reply({ 
                    embeds: [selectEmbed], 
                    components: [selectRow], 
                    ephemeral: true 
                });

            } catch (error) {
                console.error('Error showing channel selection:', error);
                await interaction.reply({ 
                    content: '❌ Error loading channels. Please try again.', 
                    ephemeral: true 
                });
            }

        } else if (interaction.customId === 'create_giveaway_modal') {
            // Process final giveaway creation
            const item = interaction.fields.getTextInputValue('item');
            const quantity = parseInt(interaction.fields.getTextInputValue('quantity'));
            const winners = parseInt(interaction.fields.getTextInputValue('winners'));
            const durationStr = interaction.fields.getTextInputValue('duration');
            const minParticipants = parseInt(interaction.fields.getTextInputValue('minparticipants')) || 3;
            const channelId = interaction.fields.getTextInputValue('channelid');

            const duration = parseTime(durationStr);
            if (duration === 0) {
                return interaction.reply({ 
                    content: '❌ Invalid duration format. Use formats like "1h 30m" or "2d 4h".', 
                    ephemeral: true 
                });
            }

            if (isNaN(quantity) || quantity < 1) {
                return interaction.reply({ 
                    content: '❌ Quantity must be a valid number greater than 0.', 
                    ephemeral: true 
                });
            }

            if (isNaN(winners) || winners < 1) {
                return interaction.reply({ 
                    content: '❌ Number of winners must be a valid number greater than 0.', 
                    ephemeral: true 
                });
            }

            try {
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
                    channelId
                };

                const embed = createGiveawayEmbed(giveaway);
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`participate_${giveawayId}`)
                            .setLabel('🎉 Participate')
                            .setStyle(ButtonStyle.Primary)
                    );

                const channel = await client.channels.fetch(channelId);
                const message = await channel.send({ embeds: [embed], components: [row] });
                
                giveaway.messageId = message.id;
                activeGiveaways.set(giveawayId, giveaway);
                await saveData();

                // Set timer to end giveaway
                setTimeout(() => endGiveaway(giveawayId), duration);

                await interaction.reply({ 
                    content: `✅ Giveaway created in <#${channelId}>! ID: \`${giveawayId}\``, 
                    ephemeral: true 
                });

            } catch (error) {
                console.error('Error creating giveaway:', error);
                await interaction.reply({ 
                    content: '❌ Error creating giveaway. Please check the channel ID and try again.', 
                    ephemeral: true 
                });
            }
        }

    } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'channel_select') {
            const selectedChannelId = interaction.values[0];
            
            // Create final giveaway modal
            const giveawayModal = new ModalBuilder()
                .setCustomId('create_giveaway_modal')
                .setTitle('Create Giveaway - Details');

            const itemInput = new TextInputBuilder()
                .setCustomId('item')
                .setLabel('Item Name')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g., Dragon Pet')
                .setRequired(true);

            const quantityInput = new TextInputBuilder()
                .setCustomId('quantity')
                .setLabel('Quantity')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g., 2')
                .setValue('1')
                .setRequired(true);

            const winnersInput = new TextInputBuilder()
                .setCustomId('winners')
                .setLabel('Number of Winners')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g., 3')
                .setValue('1')
                .setRequired(true);

            const durationInput = new TextInputBuilder()
                .setCustomId('duration')
                .setLabel('Duration')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g., 1h 30m, 2d 4h')
                .setRequired(true);

            const minParticipantsInput = new TextInputBuilder()
                .setCustomId('minparticipants')
                .setLabel('Minimum Participants (optional)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Default: 3')
                .setRequired(false);

            // Hidden field to store channel ID
            const channelIdInput = new TextInputBuilder()
                .setCustomId('channelid')
                .setLabel('Selected Channel ID (DO NOT EDIT)')
                .setStyle(TextInputStyle.Short)
                .setValue(selectedChannelId)
                .setRequired(true);

            const rows = [
                new ActionRowBuilder().addComponents(itemInput),
                new ActionRowBuilder().addComponents(quantityInput),
                new ActionRowBuilder().addComponents(winnersInput),
                new ActionRowBuilder().addComponents(durationInput),
                new ActionRowBuilder().addComponents(channelIdInput)
            ];

            giveawayModal.addComponents(rows);

            await interaction.showModal(giveawayModal);
        }

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

            // Update the embed with new participant count
            const updatedEmbed = createGiveawayEmbed(giveaway);
            await interaction.update({ embeds: [updatedEmbed] });

            // Send confirmation DM
            try {
                const confirmEmbed = new EmbedBuilder()
                    .setTitle('✅ Participation Confirmed')
                    .setDescription(`You are now participating in the giveaway for **${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}**!`)
                    .setColor(0x00ff00)
                    .setTimestamp();

                await interaction.user.send({ embeds: [confirmEmbed] });
            } catch (error) {
                console.log(`Could not send confirmation DM to ${interaction.user.tag}`);
            }
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

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
