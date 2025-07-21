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
    if (globalImage) embed.setImage(globalImage);
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
    if (globalImage) embed.setImage(globalImage);
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
    if (globalImage) embed.setImage(globalImage);
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

// Slash commands
const commands = [
    new SlashCommandBuilder().setName('creategiveaway').setDescription('Create a new giveaway with interactive channel selection'),
    new SlashCommandBuilder()
        .setName('globalimage')
        .setDescription('Set global image for giveaways')
        .addAttachmentOption(option => option.setName('image').setDescription('Image to use for all giveaways').setRequired(true)),
    new SlashCommandBuilder()
        .setName('editgiveaway')
        .setDescription('Edit an active giveaway')
        .addStringOption(option => option.setName('giveaway').setDescription('Giveaway ID or item name').setRequired(true))
        .addStringOption(option => option.setName('item').setDescription('New item name').setRequired(false))
        .addIntegerOption(option => option.setName('quantity').setDescription('New quantity').setRequired(false).setMinValue(1))
        .addIntegerOption(option => option.setName('winners').setDescription('New number of winners').setRequired(false).setMinValue(1)),
    new SlashCommandBuilder()
        .setName('editgmessage')
        .setDescription('Edit the minimum participants message')
        .addStringOption(option => option.setName('giveaway').setDescription('Giveaway ID or item name').setRequired(true))
        .addIntegerOption(option => option.setName('minparticipants').setDescription('New minimum participants required').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
        .setName('listparticipants')
        .setDescription('List all participants of a giveaway')
        .addStringOption(option => option.setName('giveaway').setDescription('Giveaway ID or item name').setRequired(true)),
    new SlashCommandBuilder().setName('help').setDescription('Show all available commands')
];

// Register slash commands
async function registerCommands() {
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
