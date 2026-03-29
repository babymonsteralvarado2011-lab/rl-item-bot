require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');

const fetch = require('node-fetch');
const cron = require('node-cron');
const fs = require('fs');

// ===== ENV =====
const {
  TOKEN,
  CLIENT_ID,
  GUILD_ID,
  ALERT_CHANNEL_ID,
  USER_ID
} = process.env;

// ===== DATA =====
const DATA_FILE = './data.json';
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ wanted: [], lastShopHash: "" }, null, 2));
}
const readData = () => JSON.parse(fs.readFileSync(DATA_FILE));
const writeData = d => fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));

// ===== CLIENT =====
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ===== COMMANDS (🔥 FIXED) =====
const commands = [
  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Open Rocket League item shop'),

  new SlashCommandBuilder()
    .setName('additem')
    .setDescription('Track an item')
    .addStringOption(o =>
      o.setName('name')
        .setDescription('Item name to track') // ✅ FIX
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('removeitem')
    .setDescription('Remove tracked item')
    .addStringOption(o =>
      o.setName('name')
        .setDescription('Item name to remove') // ✅ FIX
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('listitems')
    .setDescription('Show tracked items')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

// ===== HELPERS =====
const normalize = str => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ===== FETCH SHOP =====
async function fetchShop() {
  let items = [];

  try {
    const res = await fetch('https://rl-proxy-production.up.railway.app/shop');
    const json = await res.json();
    if (json.items) items = items.concat(json.items);
  } catch {}

  try {
    const res = await fetch("https://api.allorigins.win/raw?url=https://rl.insider.gg/api/shop");
    const json = await res.json();

    if (json.data) {
      for (const section in json.data) {
        for (const item of json.data[section]) {
          items.push({
            name: item.name,
            price: item.price,
            rarity: item.rarity,
            section: section.toLowerCase()
          });
        }
      }
    }
  } catch {}

  try {
    const res = await fetch("https://api.allorigins.win/raw?url=https://rlshop.gg/api/shop");
    const json = await res.json();
    const raw = json.items || json;

    items = items.concat(raw.map(i => ({
      name: i.name || "Unknown",
      price: i.price || "?",
      rarity: i.rarity || "Unknown",
      section: (i.section || "other").toLowerCase()
    })));
  } catch {}

  return items.map(i => {
    let category = "other";
    if (i.section.includes("bundle")) category = "bundles";
    else if (i.section.includes("daily")) category = "daily";
    else if (i.section.includes("featured")) category = "featured";

    return { ...i, category };
  });
}

// ===== FILTER =====
function filterItems(items, category, rarity) {
  let filtered = items.filter(i => i.category === category);

  if (rarity !== 'all') {
    filtered = filtered.filter(i =>
      i.rarity.toLowerCase().includes(rarity)
    );
  }

  return filtered;
}

// ===== EMBED =====
function buildEmbed(items, category, page, rarity) {
  const perPage = 5;
  const filtered = filterItems(items, category, rarity);
  const slice = filtered.slice(page * perPage, page * perPage + perPage);

  return new EmbedBuilder()
    .setTitle(`🛒 ${category.toUpperCase()} SHOP`)
    .setDescription(
      slice.length
        ? slice.map(i =>
            `**${i.name}**\n💰 ${i.price} credits\n🎨 ${i.rarity}`
          ).join('\n\n')
        : 'No items found'
    )
    .setFooter({ text: `Page ${page + 1}` });
}

// ===== COMPONENTS =====
function buildComponents(currentCategory) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('featured').setLabel('Featured').setStyle(currentCategory === 'featured' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('daily').setLabel('Daily').setStyle(currentCategory === 'daily' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('bundles').setLabel('Bundles').setStyle(currentCategory === 'bundles' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('other').setLabel('Other').setStyle(currentCategory === 'other' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prev').setLabel('⬅️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('next').setLabel('➡️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('refresh').setLabel('🔄').setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('filter')
        .setPlaceholder('Filter rarity')
        .addOptions([
          { label: 'All', value: 'all' },
          { label: 'Import', value: 'import' },
          { label: 'Exotic', value: 'exotic' },
          { label: 'Black Market', value: 'blackmarket' }
        ])
    )
  ];
}

// ===== READY =====
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
});

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {
  const data = readData();

  if (interaction.isChatInputCommand()) {
    try {
      if (interaction.commandName === 'shop') {
        await interaction.deferReply();

        let items = await fetchShop();
        let category = 'featured';
        let page = 0;
        let rarity = 'all';

        const msg = await interaction.editReply({
          embeds: [buildEmbed(items, category, page, rarity)],
          components: buildComponents(category),
          fetchReply: true
        });

        const collector = msg.createMessageComponentCollector({ time: 300000 });

        collector.on('collect', async i => {
          if (i.user.id !== interaction.user.id)
            return i.reply({ content: "Not your menu", ephemeral: true });

          if (['featured','daily','bundles','other'].includes(i.customId)) {
            category = i.customId;
            page = 0;
          }

          if (i.customId === 'next') page++;
          if (i.customId === 'prev') page = Math.max(0, page - 1);
          if (i.customId === 'refresh') items = await fetchShop();
          if (i.isStringSelectMenu()) { rarity = i.values[0]; page = 0; }

          await i.update({
            embeds: [buildEmbed(items, category, page, rarity)],
            components: buildComponents(category)
          });
        });
      }

      if (interaction.commandName === 'additem') {
        const name = interaction.options.getString('name');
        if (!data.wanted.includes(name)) {
          data.wanted.push(name);
          writeData(data);
          await interaction.reply(`✅ Tracking ${name}`);
        } else await interaction.reply('Already tracking');
      }

      if (interaction.commandName === 'removeitem') {
        const name = interaction.options.getString('name');
        data.wanted = data.wanted.filter(i => normalize(i) !== normalize(name));
        writeData(data);
        await interaction.reply(`❌ Removed ${name}`);
      }

      if (interaction.commandName === 'listitems') {
        await interaction.reply(data.wanted.length ? data.wanted.join('\n') : 'None');
      }

    } catch (err) {
      console.error(err);
      if (interaction.deferred) await interaction.editReply('❌ Error');
      else await interaction.reply('❌ Error');
    }
  }
});

// ===== ALERTS =====
async function checkShop() {
  const items = await fetchShop();
  const data = readData();

  const matches = items.filter(i =>
    data.wanted.some(w => normalize(i.name).includes(normalize(w)))
  );

  if (matches.length) {
    const channel = await client.channels.fetch(ALERT_CHANNEL_ID);
    await channel.send({
      content: `<@${USER_ID}>`,
      embeds: [new EmbedBuilder().setTitle('🚨 Found!').setDescription(matches.map(i => i.name).join('\n'))]
    });
  }
}

cron.schedule('* * * * *', checkShop);

client.login(TOKEN);
