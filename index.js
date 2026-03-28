require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder
} = require('discord.js');

const fetch = require('node-fetch');
const cron = require('node-cron');
const fs = require('fs');

// ===== ENV =====
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SHOP_CHANNEL_ID = process.env.SHOP_CHANNEL_ID;
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID;
const USER_ID = process.env.USER_ID;

const SHOP_API = 'https://rlshop.gg/api/shop';
const SHOP_IMAGE = 'https://bot.rocketslabs.com/shop-image';

const DATA_FILE = './data.json';

// ===== CHECK ENV =====
if (!TOKEN || !CLIENT_ID || !GUILD_ID || !SHOP_CHANNEL_ID || !ALERT_CHANNEL_ID || !USER_ID) {
  console.error("❌ Missing environment variables");
  process.exit(1);
}

// ===== DATA =====
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    wanted: [],
    lastFound: [],
    lastShopHash: ""
  }, null, 2));
}

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE));
  } catch {
    return { wanted: [], lastFound: [], lastShopHash: "" };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ===== CLIENT =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName('shop').setDescription('Show current shop'),

  new SlashCommandBuilder()
    .setName('additem')
    .setDescription('Track item')
    .addStringOption(opt => opt.setName('name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removeitem')
    .setDescription('Remove item')
    .addStringOption(opt => opt.setName('name').setRequired(true)),

  new SlashCommandBuilder().setName('listitems').setDescription('List items')
].map(c => c.toJSON());

// ===== REGISTER =====
const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ Commands registered");
}

// ===== READY =====
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
  checkShop(true);
});

// ===== HELPERS =====
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findMatches(shop, wanted) {
  return shop.filter(item =>
    wanted.some(w => normalize(item.name).includes(normalize(w)))
  );
}

// 🗂️ GROUPING FUNCTION
function groupItems(items) {
  const groups = {
    Featured: [],
    Daily: [],
    Bundles: [],
    Other: []
  };

  items.forEach(item => {
    const type = (item.section || item.type || "").toLowerCase();

    if (type.includes("featured")) groups.Featured.push(item);
    else if (type.includes("daily")) groups.Daily.push(item);
    else if (type.includes("bundle")) groups.Bundles.push(item);
    else groups.Other.push(item);
  });

  return groups;
}

// ===== COMMAND HANDLER =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const data = readData();

  if (interaction.commandName === 'shop') {
    const res = await fetch(SHOP_API);
    const json = await res.json();
    const items = json.items || json;

    const groups = groupItems(items);

    const image = new AttachmentBuilder(SHOP_IMAGE, { name: 'shop.png' });

    const embed = new EmbedBuilder()
      .setTitle('🛒 Rocket League Item Shop')
      .setColor(0x00b0f4)
      .setImage('attachment://shop.png')
      .setTimestamp();

    if (groups.Featured.length)
      embed.addFields({
        name: '⭐ Featured',
        value: groups.Featured.slice(0, 5).map(i => `• ${i.name} — ${i.price}c`).join('\n')
      });

    if (groups.Daily.length)
      embed.addFields({
        name: '📅 Daily',
        value: groups.Daily.slice(0, 5).map(i => `• ${i.name} — ${i.price}c`).join('\n')
      });

    if (groups.Bundles.length)
      embed.addFields({
        name: '📦 Bundles',
        value: groups.Bundles.slice(0, 3).map(i => `• ${i.name} — ${i.price}c`).join('\n')
      });

    await interaction.reply({ embeds: [embed], files: [image] });
  }

  if (interaction.commandName === 'additem') {
    const name = interaction.options.getString('name');

    if (!data.wanted.includes(name)) {
      data.wanted.push(name);
      writeData(data);
      await interaction.reply(`✅ Tracking **${name}**`);
    } else {
      await interaction.reply('⚠️ Already tracking');
    }
  }

  if (interaction.commandName === 'removeitem') {
    const name = interaction.options.getString('name');
    data.wanted = data.wanted.filter(i => i.toLowerCase() !== name.toLowerCase());
    writeData(data);
    await interaction.reply(`❌ Removed **${name}**`);
  }

  if (interaction.commandName === 'listitems') {
    await interaction.reply(
      data.wanted.length
        ? data.wanted.join('\n')
        : 'No items tracked'
    );
  }
});

// ===== SHOP CHECK =====
async function checkShop(force = false) {
  try {
    const res = await fetch(SHOP_API);
    const json = await res.json();
    const items = json.items || json;

    const data = readData();

    const shopHash = JSON.stringify(items.map(i => i.name));

    if (!force && shopHash === data.lastShopHash) return;

    console.log("🆕 Shop Updated!");
    data.lastShopHash = shopHash;

    const groups = groupItems(items);

    const shopChannel = await client.channels.fetch(SHOP_CHANNEL_ID);
    const image = new AttachmentBuilder(SHOP_IMAGE, { name: 'shop.png' });

    const embed = new EmbedBuilder()
      .setTitle('🛒 Shop Updated (Epic Synced)')
      .setColor(0x00b0f4)
      .setImage('attachment://shop.png')
      .setTimestamp();

    if (groups.Featured.length)
      embed.addFields({
        name: '⭐ Featured',
        value: groups.Featured.slice(0, 5).map(i => `• ${i.name} — ${i.price}c`).join('\n')
      });

    if (groups.Daily.length)
      embed.addFields({
        name: '📅 Daily',
        value: groups.Daily.slice(0, 5).map(i => `• ${i.name} — ${i.price}c`).join('\n')
      });

    if (groups.Bundles.length)
      embed.addFields({
        name: '📦 Bundles',
        value: groups.Bundles.slice(0, 3).map(i => `• ${i.name} — ${i.price}c`).join('\n')
      });

    await shopChannel.send({ embeds: [embed], files: [image] });

    // ===== ALERTS =====
    const matches = findMatches(items, data.wanted);
    const newMatches = matches.filter(i => !data.lastFound.includes(i.name));

    if (newMatches.length > 0) {
      const alertChannel = await client.channels.fetch(ALERT_CHANNEL_ID);

      const alertEmbed = new EmbedBuilder()
        .setTitle('🚨 Tracked Item Found!')
        .setColor(0xff0000)
        .setDescription(
          newMatches.map(i => `• ${i.name} — ${i.price}c`).join('\n')
        );

      await alertChannel.send({
        content: `<@${USER_ID}>`,
        embeds: [alertEmbed]
      });

      data.lastFound = matches.map(i => i.name);
    }

    writeData(data);

  } catch (err) {
    console.error("❌ Shop check failed:", err);
  }
}

// ===== EPIC RESET TIME (5PM UTC EXACT) =====
cron.schedule('0 17 * * *', () => {
  console.log("⏰ Epic shop reset time reached");
  checkShop(true);
});

// ===== BACKUP CHECK EVERY 2 MIN =====
cron.schedule('*/2 * * * *', () => {
  checkShop();
});

// ===== LOGIN =====
client.login(TOKEN);
