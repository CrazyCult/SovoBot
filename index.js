require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger');
const DataManager = require('./src/data/DataManager');
const ApiClient = require('./src/api/ApiClient');
const OrderbookWatcher = require('./src/services/OrderbookWatcher');

// Vérification du token Discord
if (!process.env.DISCORD_TOKEN) {
  logger.error('❌ DISCORD_TOKEN manquant dans le fichier .env');
  process.exit(1);
}

class SoccerverseBot {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
    
    // Services principaux
    this.dataManager = new DataManager();
    this.apiClient = new ApiClient();
    this.commands = new Map();
    
    // Service de surveillance orderbook (sera initialisé après le login)
    this.orderbookWatcher = null;
    
    // Charger les commandes
    this.loadCommands();
  }

  // Charger toutes les commandes depuis le dossier commands
  loadCommands() {
    const commandsPath = path.join(__dirname, 'src', 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      const command = require(filePath);
      
      if (command.name) {
        this.commands.set(command.name, command);
        logger.info(`✅ Commande chargée: ${command.name}`);
      }
    }
  }

  async initialize() {
    logger.info('🚀 Démarrage du bot Soccerverse v3.0...');
    
    // Charger les données persistantes
    await this.dataManager.load();
    
    // Event: Bot prêt
    this.client.once('ready', () => {
      logger.info(`✅ ${this.client.user.tag} est en ligne !`);
      logger.info(`📊 Connecté à ${this.client.guilds.cache.size} serveur(s)`);
      
      // Définir le statut
      this.client.user.setActivity('⚽ Soccerverse | !help', { type: 'WATCHING' });
      
      // Initialiser le service de surveillance orderbook
      this.orderbookWatcher = new OrderbookWatcher(this.client, this.dataManager, this.apiClient);
      logger.info('📊 Service de surveillance orderbook initialisé');
    });

    // Event: Messages (commandes avec préfixe !)
    this.client.on('messageCreate', async (message) => {
      // Ignorer les bots
      if (message.author.bot) return;
      
      // Vérifier le préfixe
      if (!message.content.startsWith('!')) return;
      
      // Parser la commande
      const args = message.content.slice(1).trim().split(/ +/);
      const commandName = args.shift().toLowerCase();
      
      // Trouver et exécuter la commande
      const command = this.commands.get(commandName);
      if (!command) return;
      
      try {
        await command.execute(message, args, {
          apiClient: this.apiClient,
          dataManager: this.dataManager,
          orderbookWatcher: this.orderbookWatcher
        });
      } catch (error) {
        logger.error(`Erreur commande ${commandName}:`, error);
        await message.reply('❌ Une erreur est survenue lors de l\'exécution de la commande.');
      }
    });

    // Event: Interactions (boutons, slash commands)
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
      
      // Gérer les interactions de boutons
      await this.handleInteraction(interaction);
    });

    // Sauvegarde automatique toutes les 5 minutes
    setInterval(async () => {
      try {
        await this.dataManager.save();
      } catch (error) {
        logger.error('Erreur sauvegarde automatique:', error);
      }
    }, 5 * 60 * 1000);

    // Sauvegarde à l'arrêt
    process.on('SIGINT', async () => {
      logger.info('🔄 Arrêt du bot en cours...');
      await this.dataManager.save();
      await this.client.destroy();
      process.exit(0);
    });
  }

  async handleInteraction(interaction) {
    const [action, ...params] = interaction.customId.split('_');
    
    try {
      switch (action) {
        case 'register':
          await this.handleRegisterButton(interaction, params[0]);
          break;
        case 'unregister':
          await this.handleUnregisterButton(interaction, params[0]);
          break;
        case 'orderbook':
          await this.handleOrderbookButton(interaction, params);
          break;
        default:
          await interaction.reply({ 
            content: '❌ Interaction non reconnue.', 
            ephemeral: true 
          });
      }
    } catch (error) {
      logger.error(`Erreur interaction ${action}:`, error);
      if (!interaction.replied) {
        await interaction.reply({ 
          content: '❌ Une erreur est survenue.', 
          ephemeral: true 
        });
      }
    }
  }

  async handleRegisterButton(interaction, clubId) {
    if (!clubId) {
      await interaction.reply({ 
        content: '❌ ID de club manquant.', 
        ephemeral: true 
      });
      return;
    }

    const channelId = interaction.channel.id;
    const isRegistered = this.dataManager.isTeamRegistered(channelId, clubId);
    
    if (isRegistered) {
      await interaction.reply({ 
        content: '⚠️ Ce club est déjà enregistré dans ce salon.', 
        ephemeral: true 
      });
      return;
    }

    this.dataManager.registerTeam(channelId, clubId);
    await this.dataManager.save();
    
    await interaction.reply({ 
      content: `✅ Club ID ${clubId} enregistré ! Vous recevrez les notifications dans ce salon.`, 
      ephemeral: true 
    });
  }

  async handleUnregisterButton(interaction, clubId) {
    const channelId = interaction.channel.id;
    const isRegistered = this.dataManager.isTeamRegistered(channelId, clubId);
    
    if (!isRegistered) {
      await interaction.reply({ 
        content: '⚠️ Ce club n\'est pas enregistré dans ce salon.', 
        ephemeral: true 
      });
      return;
    }

    this.dataManager.unregisterTeam(channelId, clubId);
    await this.dataManager.save();
    
    await interaction.reply({ 
      content: `✅ Club ID ${clubId} retiré des notifications.`, 
      ephemeral: true 
    });
  }

  async handleOrderbookButton(interaction, params) {
    const [action, clubId] = params;
    const channelId = interaction.channel.id;
    
    switch (action) {
      case 'watch':
        // Demander les critères de surveillance
        await interaction.reply({
          content: '🔍 **Configurer la surveillance des ordres**\n\n' +
                   'Utilisez la commande suivante pour définir vos critères :\n' +
                   `\`!orderbook ${clubId} <prix_min> <prix_max>\`\n\n` +
                   '**Exemples :**\n' +
                   `• \`!orderbook ${clubId} 1000 5000\` - Surveiller les ordres entre 1000$ et 5000$\n` +
                   `• \`!orderbook ${clubId} 2000\` - Surveiller les ordres à partir de 2000$`,
          ephemeral: true
        });
        break;
        
      case 'stop':
        if (this.orderbookWatcher) {
          this.orderbookWatcher.disableWatching(channelId, parseInt(clubId));
          await this.dataManager.save();
          
          await interaction.reply({
            content: `✅ Surveillance des ordres arrêtée pour le club #${clubId}.`,
            ephemeral: true
          });
        }
        break;
        
      case 'refresh':
        // Relancer la commande orderbook
        try {
          const orderbookCommand = this.commands.get('orderbook');
          if (orderbookCommand) {
            // Simuler l'exécution de la commande
            await interaction.deferReply();
            
            // Créer un objet message simulé
            const simulatedMessage = {
              channel: interaction.channel,
              reply: async (options) => {
                await interaction.editReply(options);
              }
            };
            
            await orderbookCommand.execute(simulatedMessage, [clubId], {
              apiClient: this.apiClient,
              dataManager: this.dataManager,
              orderbookWatcher: this.orderbookWatcher
            });
          }
        } catch (error) {
          await interaction.reply({
            content: '❌ Erreur lors de l\'actualisation de l\'orderbook.',
            ephemeral: true
          });
        }
        break;
        
      default:
        await interaction.reply({ 
          content: '❌ Action orderbook non reconnue.', 
          ephemeral: true 
        });
    }
  }

  async start() {
    await this.initialize();
    await this.client.login(process.env.DISCORD_TOKEN);
  }
}

// Démarrer le bot
const bot = new SoccerverseBot();
bot.start().catch(error => {
  logger.error('❌ Erreur fatale:', error);
  process.exit(1);
});
