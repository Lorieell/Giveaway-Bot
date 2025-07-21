const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelType } = require('discord.js');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// Initialize Express server for Render hosting
const app = express();
app.get('/', (req, res) => res.send('Discord Giveaway Bot is alive! 🎉'));

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Keepalive server running on 0.0.0.0:${port}`));

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
    GIVEAWAY: '1396583158815789106', // giveaway role
    AUTHORIZED: ['1392125837586989067', '1392126513612062770', '1396269951404474538']
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
        for (const file of Object.values(files)) {
            try {
                await fs.access(file);
            } catch {
                await fs.writeFile(file, JSON.stringify(file.includes('giveaways') ? [] : { counter: 0, globalImage: null }, null, 2));
                console.log(`Created empty ${file}`);
            }
        }
    } registerCommands() {
    try {
        if (!process.env.CLIENT_ID || !process.env.DISCORD_TOKEN) {
            throw new Error('CLIENT_ID or DISCORD_TOKEN is not defined in environment variables');
        }
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        console.log('Started refreshing application (/) commands.');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
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
            if (commandName !== 'help' && (!interaction.member || !hasAuthorizedRole(interaction.member))) {
                return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
            }

            if (commandName === 'creategiveaway') {
                const initModal = new ModalBuilder()
                    .setCustomId('init_giveaway_modal')
                    .setTitle('Create Giveaway - Step 1');
                const instructionInput = new TextInputBuilder()
                    .setCustomId('instruction')
                    .setLabel('Instructions')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue('Next, you will select the channel where the giveaway will be posted.\nClick Submit to continue to channel selection.')
                    .setRequired(false);
                initModal.addComponents(new ActionRowBuilder().addComponents(instructionInput));
                await interaction.showModal(initModal);
            } else if (commandName === 'globalimage') {
                const attachment = interaction.options.getAttachment('image');
                if (!attachment?.contentType?.startsWith('image/')) {
                    return interaction.reply({ content: '❌ Please upload a valid image file.', ephemeral: true });
                }
                globalImage = attachment.url;
                await saveData();
                await interaction.reply({ embeds: [new EmbedBuilder()
                    .setTitle('✅ Global Image Updated')
                    .setDescription('This image will now be used in all giveaway embeds.')
                    .setImage(globalImage)
                    .setColor(0x00ff00)], ephemeral: true });
            } else if (commandName === 'editgiveaway') {
                const giveawayQuery = interaction.options.getString('giveaway');
                const newItem = interaction.options.getString('item');
                const newQuantity = interaction.options.getInteger('quantity');
                const newWinners = interaction.options.getInteger('winners');
                let giveaway = activeGiveaways.get(giveawayQuery) || Array.from(activeGiveaways.values()).find(g => g.item.toLowerCase().includes(giveawayQuery.toLowerCase()));
                if (!giveaway) return interaction.reply({ content: '❌ Giveaway not found.', ephemeral: true });
                if (newItem) giveaway.item = newItem;
                if (newQuantity) giveaway.quantity = newQuantity;
                if (newWinners) giveaway.winners = newWinners;
                const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
                if (!channel) return interaction.reply({ content: `❌ Giveaway channel (${giveaway.channelId}) not found.`, ephemeral: true });
                const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
                if (!message) return interaction.reply({ content: `❌ Giveaway message not found.`, ephemeral: true });
                await message.edit({ embeds: [createGiveawayEmbed(giveaway)] });
                await saveData();
                await interaction.reply({ content: '✅ Giveaway updated successfully!', ephemeral: true });
            } else if (commandName === 'editgmessage') {
                const giveawayQuery = interaction.options.getString('giveaway');
                const newMinParticipants = interaction.options.getInteger('minparticipants');
                let giveaway = activeGiveaways.get(giveawayQuery) || Array.from(activeGiveaways.values()).find(g => g.item.toLowerCase().includes(giveawayQuery.toLowerCase()));
                if (!giveaway) return interaction.reply({ content: '❌ Giveaway not found.', ephemeral: true });
                giveaway.minParticipants = newMinParticipants;
                const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
                if (!channel) return interaction.reply({ content: `❌ Giveaway channel (${giveaway.channelId}) not found.`, ephemeral: true });
                const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
                if (!message) return interaction.reply({ content: `❌ Giveaway message not found.`, ephemeral: true });
                await message.edit({ embeds: [createGiveawayEmbed(giveaway)] });
                await saveData();
                await interaction.reply({ content: '✅ Minimum participants message updated!', ephemeral: true });
            } else if (commandName === 'listparticipants') {
                const giveawayQuery = interaction.options.getString('giveaway');
                let giveaway = activeGiveaways.get(giveawayQuery) || Array.from(activeGiveaways.values()).find(g => g.item.toLowerCase().includes(giveawayQuery.toLowerCase()));
                if (!giveaway) return interaction.reply({ content: '❌ Giveaway not found.', ephemeral: true });
                if (giveaway.participants.length === 0) return interaction.reply({ embeds: [new EmbedBuilder()
                    .setTitle('📋 Participants List')
                    .setDescription(`**Giveaway**: ${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}\n\n❌ No participants yet.`)
                    .setColor(0xff9900)
                    .setTimestamp()], ephemeral: true });
                const participantChunks = [];
                let currentChunk = '';
                for (let i = 0; i < giveaway.participants.length; i++) {
                    const participant = `${i + 1}. <@${giveaway.participants[i]}>\n`;
                    if (currentChunk.length + participant.length > 1000) {
                        participantChunks.push(currentChunk);
                        currentChunk = participant;
                    } else currentChunk += participant;
                }
                if (currentChunk) participantChunks.push(currentChunk);
                const participantsEmbed = new EmbedBuilder()
                    .setTitle('📋 Participants List')
                    .setDescription(`**Giveaway**: ${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}\n**Total Participants**: ${giveaway.participants.length}\n**Minimum Required**: ${giveaway.minParticipants}`)
                    .setColor(0x00ff00)
                    .setTimestamp();
                participantChunks.slice(0, 5).forEach((chunk, index) => participantsEmbed.addFields({
                    name: index === 0 ? '👥 Participants' : `👥 Participants (cont'd ${index + 1})`,
                    value: chunk,
                    inline: false
                }));
                if (participantChunks.length > 5) participantsEmbed.setFooter({ text: `... and ${giveaway.participants.length - (participantChunks.slice(0, 5).join('').match(/\n/g) || []).length} more participants` });
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
                    .setFooter({ text: 'Giveaways are posted in the selected channel and winners announced in #🏆┃winners' })
                    .setTimestamp();
                await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
            }
        } else if (interaction.isModalSubmit() && interaction.customId === 'init_giveaway_modal') {
            await interaction.deferReply({ ephemeral: true });
            const guild = interaction.guild;
            const channels = await guild.channels.fetch();
            const textChannels = channels.filter(ch => ch.type === ChannelType.GuildText && ch.permissionsFor(interaction.user).has(PermissionFlagsBits.ViewChannel)).first(25);
            if (textChannels.length === 0) return interaction.editReply({ content: '❌ No accessible text channels found.', components: [] });
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('channel_select')
                .setPlaceholder('Select the channel for the giveaway')
                .addOptions(textChannels.map(ch => ({
                    label: `#${ch.name}`,
                    description: `Channel ID: ${ch.id}`,
                    value: ch.id
                })));
            await interaction.editReply({ 
                content: 'Please select the channel for your giveaway:', 
                components: [new ActionRowBuilder().addComponents(selectMenu)], 
                ephemeral: true 
            });
        } else if (interaction.isStringSelectMenu() && interaction.customId === 'channel_select') {
            const selectedChannelId = interaction.values[0];
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
            const channelIdInput = new TextInputBuilder()
                .setCustomId('channelid')
                .setLabel('Selected Channel ID (DO NOT EDIT)')
                .setStyle(TextInputStyle.Short)
                .setValue(selectedChannelId)
                .setRequired(true);
            giveawayModal.addComponents(
                new ActionRowBuilder().addComponents(itemInput),
                new ActionRowBuilder().addComponents(quantityInput),
                new ActionRowBuilder().addComponents(winnersInput),
                new ActionRowBuilder().addComponents(durationInput),
                new ActionRowBuilder().addComponents(minParticipantsInput),
                new ActionRowBuilder().addComponents(channelIdInput)
            );
            await interaction.showModal(giveawayModal);
        } else if (interaction.isModalSubmit() && interaction.customId === 'create_giveaway_modal') {
            const item = interaction.fields.getTextInputValue('item');
            const quantity = parseInt(interaction.fields.getTextInputValue('quantity'));
            const winners = parseInt(interaction.fields.getTextInputValue('winners'));
            const durationStr = interaction.fields.getTextInputValue('duration');
            const minParticipants = parseInt(interaction.fields.getTextInputValue('minparticipants')) || 3;
            const channelId = interaction.fields.getTextInputValue('channelid');
            const duration = parseTime(durationStr);
            if (duration === 0) return interaction.reply({ content: '❌ Invalid duration format. Use formats like "1h 30m" or "2d 4h".', ephemeral: true });
            if (isNaN(quantity) || quantity < 1) return interaction.reply({ content: '❌ Quantity must be a valid number greater than 0.', ephemeral: true });
            if (isNaN(winners) || winners < 1) return interaction.reply({ content: '❌ Number of winners must be a valid number greater than 0.', ephemeral: true });
            try {
                giveawayCounter++;
                const giveawayId = `giveaway-${giveawayCounter}`;
                const endTime = Date.now() + duration;
                const giveaway = { id: giveawayId, item, quantity, winners, duration, endTime, participants: [], minParticipants, createdBy: interaction.user.id, createdAt: Date.now(), channelId };
                const embed = createGiveawayEmbed(giveaway);
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`participate_${giveawayId}`).setLabel('🎉 Participate').setStyle(ButtonStyle.Primary));
                const channel = await client.channels.fetch(channelId).catch(() => null);
                if (!channel) return interaction.reply({ content: '❌ The specified channel was not found or is inaccessible.', ephemeral: true });
                const message = await channel.send({ embeds: [embed], components: [row] });
                giveaway.messageId = message.id;
                activeGiveaways.set(giveawayId, giveaway);
                await saveData();
                setTimeout(() => endGiveaway(giveawayId), duration);
                await interaction.reply({ content: `✅ Giveaway created in <#${channelId}>! ID: \`${giveawayId}\``, ephemeral: true });
            } catch (error) {
                console.error('Error creating giveaway:', error);
                await interaction.reply({ content: '❌ Error creating giveaway. Please try again.', ephemeral: true });
            }
        } else if (interaction.isButton() && interaction.customId.startsWith('participate_')) {
            const giveawayId = interaction.customId.split('_')[1];
            const giveaway = activeGiveaways.get(giveawayId);
            if (!giveaway) return interaction.reply({ content: '❌ This giveaway is no longer active.', ephemeral: true });
            if (giveaway.participants.includes(interaction.user.id)) return interaction.reply({ content: '❌ You are already participating in this giveaway!', ephemeral: true });
            giveaway.participants.push(interaction.user.id);
            await saveData();
            await interaction.update({ embeds: [createGiveawayEmbed(giveaway)] });
            try {
                await interaction.user.send({ embeds: [new EmbedBuilder()
                    .setTitle('✅ Participation Confirmed')
                    .setDescription(`You are now participating in the giveaway for **${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}**!`)
                    .setColor(0x00ff00)
                    .setTimestamp()] });
            } catch (error) {
                console.error(`Could not send confirmation DM to ${interaction.user.tag}:`, error);
            }
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ An error occurred while processing your request.', ephemeral: true });
    }
});

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
            const cancelEmbed = new EmbedBuilder()
                .setTitle('❌ Giveaway Cancelled')
                .setDescription(`**${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''}** was cancelled.\nThe required minimum of ${giveaway.minParticipants} participants was not reached. ${giveaway.participants.length} users participated.`)
                .setColor(0xff0000)
                .setTimestamp();
            await message.edit({ embeds: [cancelEmbed], components: [] });
            const announcementChannel = await client.channels.fetch('1392122107390857266').catch(() => null);
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
            } else console.error(`Announcement channel not found`);
        } else {
            const shuffledParticipants = shuffleArray(giveaway.participants);
            const winners = shuffledParticipants.slice(0, Math.min(giveaway.winners, giveaway.participants.length));
            const endedEmbed = new EmbedBuilder()
                .setTitle(`🏆 ${giveaway.item}${giveaway.quantity > 1 ? ` ×${giveaway.quantity}` : ''} - ENDED`)
                .setColor(0xffd700)
                .addFields(
                    { name: '⏰ Duration', value: formatDuration(giveaway.duration), inline: true },
                    { name: '👑 Winners', value: winners.length > 0 ? winners.map(id => `<@${id}>`).join(', ') : 'No winners', inline: false },
                    { name: '🙋 Final Participants', value: giveaway.participants.length.toString(), inline: true }
                )
                .setTimestamp();
            if (globalImage) endedEmbed.setImage(globalImage);
            await message.edit({ embeds: [endedEmbed], components: [] });
            for (const winnerId of winners) {
                try {
                    const user = await client.users.fetch(winnerId);
                    const dmEmbed = createWinnerDMEmbed(giveaway, winners);
                    await user.send({ embeds: [dmEmbed] });
                } catch (error) {
                    console.error(`Failed to send DM to winner ${winnerId}:`, error);
                }
            }
            const winnersChannel = await client.channels.fetch('1396578011834355952').catch(() => null);
            if (winnersChannel) {
                const announcementEmbed = createWinnerAnnouncementEmbed(giveaway, winners);
                await winnersChannel.send({ embeds: [announcementEmbed] });
            } else console.error(`Winners channel not found`);
        }
        activeGiveaways.delete(giveawayId);
        await saveData();
        console.log(`Giveaway ${giveawayId} ended successfully`);
    } catch (error) {
        console.error(`Error ending giveaway ${giveawayId}:`, error);
    }
}

// Login to Discord
(async () => {
    if (!process.env.DISCORD_TOKEN) {
        console.error('Error: DISCORD_TOKEN is not defined in environment variables');
        process.exit(1);
    }
    try {
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('Error logging in:', error);
        process.exit(1);
    }
})();
