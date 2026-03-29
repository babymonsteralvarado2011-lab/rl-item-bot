require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
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
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName('shop').setDescription('Show RL shop'),
  new SlashCommandBuilder()
    .setName('additem')
    .setDescription('Track item')
    .addStringOption(o =>
      o.setName('name').setDescription('Item name').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('removeitem')
    .setDescription('Remove item')
    .addStringOption(o =>
      o.setName('name').setDescription('Item name').setRequired(true)
    ),
  new SlashCommandBuilder().setName('listitems').setDescription('List tracked')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

// ===== NORMALIZE =====
const normalize = str =>
  (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ===== 🔥 FETCH FROM YOUR PROXY =====
async function fetchShop() {
  try {
    const res = await fetch('https://rl-proxy-production.up.railway.app/shop');
    const json = await res.json();

    if (json.items && json.items.length > 0) {
      console.log("✅ Proxy shop loaded");
      return json.items;
    }

  } catch (err) {
    console.error("❌ Proxy failed:", err.message);
  }

  return [{
    name: "Proxy offline",
    price: "?",
    rarity: "Unknown",
    section: "featured"
  }];
}

// ===== EMBED =====
function buildEmbed(items) {
  return new EmbedBuilder()
    .setTitle('🛒 Rocket League Item Shop')
    .setDescription(
      items.map(i =>
        `**${i.name}**\n💰 ${i.price} credits\n🎨 ${i.rarity}`
      ).join('\n\n')
    )
    .setImage('https://rl-proxy-production.up.railway.app/shop') // optional image placeholder
    .setTimestamp();
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

// ===== COMMANDS =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const data = readData();

  try {
    if (interaction.commandName === 'shop') {
      await interaction.deferReply();

      const items = await fetchShop();

      await interaction.editReply({
        embeds: [buildEmbed(items)]
      });
    }

    if (interaction.commandName === 'additem') {
      const name = interaction.options.getString('name');

      if (!data.wanted.includes(name)) {
        data.wanted.push(name);
        writeData(data);
        await interaction.reply(`✅ Tracking ${name}`);
      } else {
        await interaction.reply('Already tracking');
      }
    }

    if (interaction.commandName === 'removeitem') {
      const name = interaction.options.getString('name');

      data.wanted = data.wanted.filter(i =>
        normalize(i) !== normalize(name)
      );

      writeData(data);

      await interaction.reply(`❌ Removed ${name}`);
    }

    if (interaction.commandName === 'listitems') {
      await interaction.reply(
        data.wanted.length
          ? data.wanted.join('\n')
          : 'No tracked items'
      );
    }

  } catch (err) {
    console.error(err);
    await interaction.reply('❌ Error occurred');
  }
});

// ===== AUTO SHOP POST =====
async function checkShop() {
  try {
    const items = await fetchShop();
    const data = readData();

    const hash = JSON.stringify(items.map(i => i.name));
    if (hash === data.lastShopHash) return;

    data.lastShopHash = hash;

    // 🔥 AUTO POST SHOP
    const shopChannel = await client.channels.fetch(SHOP_CHANNEL_ID);

    await shopChannel.send({
      embeds: [buildEmbed(items)]
    });

    // 🚨 ALERTS
    const matches = items.filter(i =>
      data.wanted.some(w =>
        normalize(i.name).includes(normalize(w))
      )
    );

    if (matches.length) {
      const alertChannel = await client.channels.fetch(ALERT_CHANNEL_ID);

      await alertChannel.send({
        content: `<@${USER_ID}>`,
        embeds: [
          new EmbedBuilder()
            .setTitle('🚨 Item Found!')
            .setDescription(matches.map(i => i.name).join('\n'))
        ]
      });
    }

    writeData(data);

  } catch (err) {
    console.error("Shop check failed:", err.message);
  }
}

// ===== CHECK EVERY MINUTE =====
cron.schedule('* * * * *', checkShop);

// ===== LOGIN =====
client.login(TOKEN);
