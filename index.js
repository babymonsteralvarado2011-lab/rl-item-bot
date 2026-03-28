const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fetch = require('node-fetch');
const cron = require('node-cron');
const fs = require('fs');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SHOP_CHANNEL_ID = process.env.SHOP_CHANNEL_ID;
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID;
const USER_ID = process.env.USER_ID;

const SHOP_API = 'https://rlshop.gg/api/shop';
const DATA_FILE = './data.json';

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    wanted: ['Anodized Pearl','Scarab','Proteus'],
    lastFound: []
  }, null, 2));
}

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

const commands = [
  new SlashCommandBuilder()
    .setName('additem')
    .setDescription('Add item')
    .addStringOption(opt => opt.setName('name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removeitem')
    .setDescription('Remove item')
    .addStringOption(opt => opt.setName('name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('listitems')
    .setDescription('List items')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
})();

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const data = readData();

  if (interaction.commandName === 'additem') {
    const name = interaction.options.getString('name');

    if (!data.wanted.includes(name)) {
      data.wanted.push(name);
      writeData(data);
      await interaction.reply(`Tracking ${name}`);
    } else {
      await interaction.reply('Already tracking');
    }
  }

  if (interaction.commandName === 'removeitem') {
    const name = interaction.options.getString('name');

    data.wanted = data.wanted.filter(i => i.toLowerCase() !== name.toLowerCase());
    writeData(data);

    await interaction.reply(`Removed ${name}`);
  }

  if (interaction.commandName === 'listitems') {
    await interaction.reply(data.wanted.join(', '));
  }
});

function findMatches(shop, wanted) {
  let matches = [];

  shop.forEach(item => {
    const name = (item.name || '').toLowerCase();

    wanted.forEach(w => {
      if (name === w.toLowerCase()) {
        matches.push(w);
      }
    });
  });

  return matches;
}

async function checkShop() {
  try {
    const res = await fetch(SHOP_API);
    const json = await res.json();

    const items = json.items || json;
    const data = readData();

    const found = findMatches(items, data.wanted);
    const newFinds = found.filter(i => !data.lastFound.includes(i));

    const shopChannel = await client.channels.fetch(SHOP_CHANNEL_ID);

    await shopChannel.send({
      embeds: [{
        title: 'Rocket League Item Shop',
        image: { url: 'https://rlshop.gg/api/image' },
        color: 0x00b0f4,
        timestamp: new Date()
      }]
    });

    if (newFinds.length > 0) {
      const alertChannel = await client.channels.fetch(ALERT_CHANNEL_ID);

      await alertChannel.send({
        content: `<@${USER_ID}>`,
        embeds: [{
          title: 'Item Found!',
          description: newFinds.join(', '),
          color: 0xff0000,
          timestamp: new Date()
        }]
      });

      data.lastFound = found;
      writeData(data);
    }

  } catch (e) {
    console.log(e);
  }
}

cron.schedule('0 17 * * *', checkShop);
cron.schedule('5 17 * * *', checkShop);

client.on('ready', checkShop);

client.login(TOKEN);
