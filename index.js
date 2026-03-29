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
  SHOP_CHANNEL_ID,
  ALERT_CHANNEL_ID,
  USER_ID
} = process.env;

// ===== DATA =====
const DATA_FILE = './data.json';

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    wanted: [],
    lastShopHash: ""
  }, null, 2));
}

const readData = () => JSON.parse(fs.readFileSync(DATA_FILE));
const writeData = d => fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));

// ===== CLIENT =====
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName('shop').setDescription('Open Rocket League shop'),
  new SlashCommandBuilder()
    .setName('additem')
    .setDescription('Track an item')
    .addStringOption(o => o.setName('name').setDescription('Item name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('removeitem')
    .setDescription('Remove tracked item')
    .addStringOption(o => o.setName('name').setDescription('Item name').setRequired(true)),
  new SlashCommandBuilder().setName('listitems').setDescription('Show tracked items')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

// ===== NORMALIZE =====
const normalize = str =>
  (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ===== FETCH SHOP (proxy + fallback) =====
async function fetchShop() {
  try {
    const res = await fetch('https://rl-proxy-production.up.railway.app/shop');
    const json = await res.json();
    if (json.items && json.items.length > 0) return json.items;
  } catch (err) {
    console.error("❌ Proxy fetch failed:", err.message);
  }

  // fallback to unblock endpoints
  const urls = [
    "https://api.allorigins.win/raw?url=https://rl.insider.gg/api/shop",
    "https://api.allorigins.win/raw?url=https://rlshop.gg/api/shop"
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      let items = [];
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
      } else if (Array.isArray(json.items) || Array.isArray(json)) {
        const raw = json.items || json;
        items = raw.map(i => ({
          name: i.name || "Unknown",
          price: i.price || "?",
          rarity: i.rarity || "Unknown",
          section: (i.section || "featured").toLowerCase()
        }));
      }
      if (items.length) return items;
    } catch {}
  }

  return [{
    name: "Shop temporarily unavailable",
    price: "?",
    rarity: "Unknown",
    section: "featured"
  }];
}

// ===== FILTER & EMBED =====
function getFiltered(items, section, rarity) {
  let filtered = items.filter(i => i.section.includes(section));
  if (rarity !== 'all') filtered = filtered.filter(i => i.rarity.toLowerCase().includes(rarity));
  return filtered;
}

function buildEmbed(items, section, page, rarity) {
  const perPage = 5;
  const filtered = getFiltered(items, section, rarity);
  const slice = filtered.slice(page * perPage, page * perPage + perPage);

  return new EmbedBuilder()
    .setTitle(`🛒 ${section.toUpperCase()} SHOP`)
    .setDescription(
      slice.length
        ? slice.map(i => `**${i.name}**\n💰 ${i.price} credits\n🎨 ${i.rarity}`).join('\n\n')
        : 'No items found'
    )
    .setImage('https://api.allorigins.win/raw?url=https://rlshop.gg/api/image')
    .setFooter({ text: `Page ${page + 1}` });
}

// ===== COMPONENTS =====
function buildComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prev').setLabel('⬅️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('next').setLabel('➡️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('refresh').setLabel('🔄').setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('filter')
        .setPlaceholder('Filter by rarity')
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
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  checkShop();
});

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {
  const data = readData();

  // Slash commands
  if (interaction.isChatInputCommand()) {
    const name = interaction.options?.getString('name');

    try {
      // SHOP
      if (interaction.commandName === 'shop') {
        await interaction.deferReply();
        let items = await fetchShop();
        let section = 'featured';
        let page = 0;
        let rarity = 'all';

        const msg = await interaction.editReply({
          embeds: [buildEmbed(items, section, page, rarity)],
          components: buildComponents(),
          fetchReply: true
        });

        const collector = msg.createMessageComponentCollector({ time: 300000 });
        collector.on('collect', async i => {
          if (i.user.id !== interaction.user.id) return i.reply({ content: "Not your menu", ephemeral: true });

          if (i.customId === 'next') page++;
          if (i.customId === 'prev') page = Math.max(0, page - 1);
          if (i.customId === 'refresh') items = await fetchShop();
          if (i.isStringSelectMenu()) { rarity = i.values[0]; page = 0; }

          await i.update({ embeds: [buildEmbed(items, section, page, rarity)], components: buildComponents() });
        });
      }

      // ADD ITEM
      if (interaction.commandName === 'additem') {
        if (!data.wanted.includes(name)) { data.wanted.push(name); writeData(data); await interaction.reply(`✅ Tracking ${name}`); }
        else await interaction.reply('⚠️ Already tracking');
      }

      // REMOVE ITEM
      if (interaction.commandName === 'removeitem') {
        data.wanted = data.wanted.filter(i => normalize(i) !== normalize(name));
        writeData(data);
        await interaction.reply(`❌ Removed ${name}`);
      }

      // LIST ITEMS
      if (interaction.commandName === 'listitems') {
        await interaction.reply(
          data.wanted.length ? `📦 Tracked:\n${data.wanted.join('\n')}` : 'None'
        );
      }
    } catch (err) {
      console.error(err);
      if (interaction.deferred) await interaction.editReply('❌ Error occurred');
      else await interaction.reply('❌ Error occurred');
    }
  }
});

// ===== AUTO SHOP CHECK & ALERTS =====
async function checkShop() {
  try {
    const items = await fetchShop();
    const data = readData();
    const hash = JSON.stringify(items.map(i => i.name));
    if (hash === data.lastShopHash) return;
    data.lastShopHash = hash;

    // ALERT TRACKED ITEMS
    const matches = items.filter(i => data.wanted.some(w => normalize(i.name).includes(normalize(w))));
    if (matches.length) {
      const channel = await client.channels.fetch(ALERT_CHANNEL_ID);
      await channel.send({
        content: `<@${USER_ID}>`,
        embeds: [new EmbedBuilder().setTitle('🚨 Item Found!').setDescription(matches.map(i => i.name).join('\n'))]
      });

      const user = await client.users.fetch(USER_ID);
      await user.send(`🚨 Found:\n${matches.map(i => i.name).join('\n')}`);
    }

    writeData(data);
  } catch (err) {
    console.error("Shop check failed:", err.message);
  }
}

// ===== CRON =====
cron.schedule('* * * * *', checkShop);

// ===== LOGIN =====
client.login(TOKEN);
