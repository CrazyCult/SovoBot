const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  try {
    const command = require(path.join(commandsPath, file));
    if (command.slashCommand) {
      commands.push(command.slashCommand.toJSON());
      console.log(`✅ ${command.name}`);
    }
  } catch(e) {
    console.log(`❌ ${file}: ${e.message}`);
  }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  console.log(`\n📡 Enregistrement de ${commands.length} commandes slash...`);
  const data = await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
  console.log(`✅ ${data.length} commandes enregistrées !`);
})().catch(console.error);
