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
const {
  TOKEN,
  CLIENT_ID,
  GUILD_ID,
  SHOP_CHANNEL_ID,
  ALERT_CHANNEL_ID,
  USER_ID
} = process.env;

// ===== API =====
const SHOP_API = 'https://rlshop.gg/api/shop';
const SHOP_IMAGE = 'https://bot.rocketslabs.com/shop-image';

const DATA_FILE = './data.json';

// ===== SAFE ENV CHECK =====
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

const readData = () => {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE));
  } catch {
    return { wanted: [], lastFound: [], lastShopHash: "" };
  }
};

const writeData = (data) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

// ===== CLIENT =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ===== COMMANDS (FIXED — NO ERRORS) =====
const commands = [
  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Show current Rocket League item shop'),

  new SlashCommandBuilder()
    .setName('additem')
    .setDescription('Track an item')
    .addStringOption(opt =>
      opt
        .setName('name')
        .setDescription('Item name to track')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('removeitem')
    .setDescription('Remove a tracked item')
    .addStringOption(opt =>
      opt
        .setName('name')
        .setDescription('Item name to remove')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('listitems')
    .setDescription('List tracked items')
].map(cmd => cmd.toJSON());

// ===== REGISTER =====
const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("✅ Commands registered");
  } catch (err) {
    console.error("❌ Command registration failed:", err);
  }
}

// ===== READY =====
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
  checkShop(true);
});

// ===== HELPERS =====
const normalize = str => str.toLowerCase().replace(/[^a-z0-9]/g, '');

const findMatches = (shop, wanted) => {
  return shop.filter(item =>
    wanted.some(w => normalize(item.name).includes(normalize(w)))
  );
};

const groupItems = (items) => {
  const groups = { Featured: [], Daily: [], Bundles: [], Other: [] };

  items.forEach(item => {
    const type = (item.section || "").toLowerCase();

    if (type.includes('featured')) groups.Featured.push(item);
    else if (type.includes('daily')) groups.Daily.push(item);
    else if (type.includes('bundle')) groups.Bundles.push(item);
    else groups.Other.push(item);
  });

  return groups;
};

// ===== COMMAND HANDLER =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const data = readData();

  try {
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
        await interaction.reply('⚠️ Already tracking that item');
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
          ? `📦 Tracked Items:\n${data.wanted.join('\n')}`
          : '❌ No items tracked'
      );
    }

  } catch (err) {
    console.error(err);
    if (!interaction.replied) {
      await interaction.reply('❌ Error occurred');
    }
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
      .setTitle('🛒 Shop Updated')
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

    await shopChannel.send({ embeds: [embed], files: [image] });

    const matches = findMatches(items, data.wanted);
    const newMatches = matches.filter(i => !data.lastFound.includes(i.name));

    if (newMatches.length > 0) {
      const alertChannel = await client.channels.fetch(ALERT_CHANNEL_ID);

      await alertChannel.send({
        content: `<@${USER_ID}>`,
        embeds: [
          new EmbedBuilder()
            .setTitle('🚨 Item Found!')
            .setColor(0xff0000)
            .setDescription(newMatches.map(i => `• ${i.name} — ${i.price}c`).join('\n'))
        ]
      });

      data.lastFound = matches.map(i => i.name);
    }

    writeData(data);

  } catch (err) {
    console.error("❌ Shop check failed:", err);
  }
}

// ===== CRON =====
cron.schedule('0 17 * * *', () => checkShop(true)); // exact reset
cron.schedule('*/2 * * * *', () => checkShop());   // backup check

// ===== LOGIN =====
client.login(TOKEN);
