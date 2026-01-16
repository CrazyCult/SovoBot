require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./src/utils/logger');
const DataManager = require('./src/data/DataManager');
const ApiClient = require('./src/api/ApiClient');
const OrderbookWatcher = require('./src/services/OrderbookWatcher');
const MatchNotificationWatcher = require('./src/services/MatchNotificationWatcher');
const MatchResultWatcher = require('./src/services/MatchResultWatcher');
const PolygonStalkerService = require('./src/services/PolygonStalkerService');
const EncheresWatcher = require('./src/services/EncheresWatcher');
const ClubNewsWatcher = require('./src/services/ClubNewsWatcher');
const GasTrackerService = require('./src/services/GasTrackerService');
const ClubFollowerWatcher = require('./src/services/ClubFollowerWatcher'); // 🆕 AJOUTÉ

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
    
    // Services de surveillance (seront initialisés après le login)
    this.orderbookWatcher = null;
    this.matchNotificationWatcher = null;
    this.matchResultWatcher = null;
    this.polygonStalkerService = null;
    this.encheresWatcher = null;
    this.clubNewsWatcher = null;
    this.gasTrackerService = null;
    this.clubFollowerWatcher = null; // 🆕 AJOUTÉ
    
    // Charger les commandes
    this.loadCommands();
  }

  // Charger toutes les commandes depuis le dossier commands
  loadCommands() {
    const commandsPath = path.join(__dirname, 'src', 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      try {
        const command = require(filePath);
        
        if (command.name) {
          this.commands.set(command.name, command);
          logger.info(`✅ Commande chargée: ${command.name}`);
        }
      } catch (error) {
        logger.error(`❌ Erreur chargement commande ${file}:`, error.message);
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
      
      // Initialiser le service de surveillance des notifications de match
      this.matchNotificationWatcher = new MatchNotificationWatcher(this.client, this.dataManager, this.apiClient);
      logger.info('⚽ Service de notifications de match initialisé');
      
      // Initialiser le service de surveillance des résultats de match
      this.matchResultWatcher = new MatchResultWatcher(this.client, this.dataManager, this.apiClient);
      logger.info('🏆 Service de notifications de résultats initialisé');
      
      // Initialiser le service de surveillance Stalker avec l'apiClient
      this.polygonStalkerService = new PolygonStalkerService(this.client, this.dataManager, this.apiClient);
      logger.info('👥 Service Stalker Soccerverse initialisé');
      
      // Initialiser le service de surveillance des enchères
      this.encheresWatcher = new EncheresWatcher(this.client, this.dataManager, this.apiClient);
      logger.info('🏆 Service de surveillance des enchères initialisé');

      // Initialiser le service de surveillance des actualités du club
      this.clubNewsWatcher = new ClubNewsWatcher(this.client, this.dataManager, this.apiClient);
      logger.info('📰 Service de surveillance des actualités du club initialisé');

      // Initialiser le service Gas Tracker
      this.gasTrackerService = new GasTrackerService(this.client, this.dataManager);
      this.gasTrackerService.start();
      logger.info('⛽ Service Gas Tracker Polygon démarré');

      // 🆕 Initialiser le service de suivi des clubs
      this.clubFollowerWatcher = new ClubFollowerWatcher(this.client, this.dataManager, this.apiClient);
      logger.info('📊 Service de suivi des clubs initialisé');
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
          orderbookWatcher: this.orderbookWatcher,
          matchNotificationWatcher: this.matchNotificationWatcher,
          matchResultWatcher: this.matchResultWatcher,
          polygonStalkerService: this.polygonStalkerService,
          encheresWatcher: this.encheresWatcher,
          clubNewsWatcher: this.clubNewsWatcher,
          gasTrackerService: this.gasTrackerService,
          clubFollowerWatcher: this.clubFollowerWatcher // 🆕 AJOUTÉ
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
        case 'watchlist':
          await this.handleWatchlistButton(interaction, params);
          break;
        case 'stalker':
          await this.handleStalkerButton(interaction, params);
          break;
        case 'encheres':
          await this.handleEncheresButton(interaction, params);
          break;
        case 'composition':
          await this.handleCompositionButton(interaction, params);
          break;
        default:
          await interaction.reply({
            content: '❌ Interaction non reconnue.',
            flags: 64 // Ephemeral flag
          });
      }
    } catch (error) {
      logger.error(`Erreur interaction ${action}:`, error);
      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content: '❌ Une erreur est survenue.',
            flags: 64 // Ephemeral flag
          });
        } catch (replyError) {
          logger.error('Erreur lors de la réponse d\'interaction:', replyError);
        }
      }
    }
  }

  async handleRegisterButton(interaction, clubId) {
    if (!clubId) {
      await interaction.reply({
        content: '❌ ID de club manquant.',
        flags: 64 // Ephemeral flag
      });
      return;
    }

    const channelId = interaction.channel.id;
    const isRegistered = this.dataManager.isTeamRegistered(channelId, clubId);
    
    if (isRegistered) {
      await interaction.reply({ 
        content: '⚠️ Ce club est déjà enregistré dans ce salon.', 
        flags: 64 // Ephemeral flag 
      });
      return;
    }

    this.dataManager.registerTeam(channelId, clubId, interaction.user.id);
    await this.dataManager.save();

    await interaction.reply({
      content: `✅ Club ID ${clubId} enregistré ! Vous recevrez les notifications (avec mentions) dans ce salon.`,
      flags: 64 // Ephemeral flag
    });
  }

  async handleUnregisterButton(interaction, clubId) {
    const channelId = interaction.channel.id;
    const isRegistered = this.dataManager.isTeamRegistered(channelId, clubId);
    
    if (!isRegistered) {
      await interaction.reply({ 
        content: '⚠️ Ce club n\'est pas enregistré dans ce salon.', 
        flags: 64 // Ephemeral flag 
      });
      return;
    }

    this.dataManager.unregisterTeam(channelId, clubId);
    await this.dataManager.save();
    
    await interaction.reply({ 
      content: `✅ Club ID ${clubId} retiré des notifications.`, 
      flags: 64 // Ephemeral flag 
    });
  }

  async handleOrderbookButton(interaction, params) {
    const [action, clubId] = params;
    const channelId = interaction.channel.id;
    
    switch (action) {
      case 'watch':
        await interaction.reply({
          content: '🔍 **Configurer la surveillance des ordres**\n\n' +
                   'Utilisez la commande suivante pour définir vos critères :\n' +
                   `\`!orderbook ${clubId} <prix_min> <prix_max>\`\n\n` +
                   '**Exemples :**\n' +
                   `• \`!orderbook ${clubId} 1000 5000\` - Surveiller les ordres entre 1000$ et 5000$\n` +
                   `• \`!orderbook ${clubId} 2000\` - Surveiller les ordres à partir de 2000$\n\n` +
                   '**Note :** La surveillance se déclenchera automatiquement quand vous utiliserez des critères de prix.',
          flags: 64 // Ephemeral flag
        });
        break;
        
      case 'stop':
        if (this.orderbookWatcher) {
          this.orderbookWatcher.disableWatching(channelId, parseInt(clubId));
          await this.dataManager.save();
          
          await interaction.reply({
            content: `✅ Surveillance des ordres arrêtée pour le club #${clubId}.`,
            flags: 64 // Ephemeral flag
          });
        }
        break;
        
      case 'refresh':
        try {
          const orderbookCommand = this.commands.get('orderbook');
          if (orderbookCommand) {
            await interaction.deferReply();
            
            const simulatedMessage = {
              channel: interaction.channel,
              reply: async (options) => {
                await interaction.editReply(options);
              }
            };
            
            await orderbookCommand.execute(simulatedMessage, [clubId], {
              apiClient: this.apiClient,
              dataManager: this.dataManager,
              orderbookWatcher: this.orderbookWatcher,
              matchNotificationWatcher: this.matchNotificationWatcher,
              matchResultWatcher: this.matchResultWatcher,
              polygonStalkerService: this.polygonStalkerService,
              encheresWatcher: this.encheresWatcher,
              clubNewsWatcher: this.clubNewsWatcher,
              gasTrackerService: this.gasTrackerService,
              clubFollowerWatcher: this.clubFollowerWatcher
            });
          }
        } catch (error) {
          await interaction.reply({
            content: '❌ Erreur lors de l\'actualisation de l\'orderbook.',
            flags: 64 // Ephemeral flag
          });
        }
        break;
        
      default:
        await interaction.reply({ 
          content: '❌ Action orderbook non reconnue.', 
          flags: 64 // Ephemeral flag 
        });
    }
  }

  async handleWatchlistButton(interaction, params) {
    const [action] = params;
    const channelId = interaction.channel.id;
    
    switch (action) {
      case 'stop':
      case 'all':
        const settings = this.dataManager.getChannelSettings(channelId);
        const orderbookWatching = settings.orderbookWatching || {};
        
        const activeWatches = Object.entries(orderbookWatching)
          .filter(([clubId, config]) => config.enabled);
        
        if (activeWatches.length === 0) {
          await interaction.reply({
            content: '⚠️ Aucune surveillance active à arrêter.',
            flags: 64 // Ephemeral flag
          });
          return;
        }
        
        for (const [clubId, config] of activeWatches) {
          if (this.orderbookWatcher) {
            this.orderbookWatcher.disableWatching(channelId, parseInt(clubId));
          }
        }
        await this.dataManager.save();
        
        await interaction.reply({
          content: `✅ ${activeWatches.length} surveillance(s) arrêtée(s) avec succès.`,
          flags: 64 // Ephemeral flag
        });
        break;
        
      case 'refresh':
        try {
          const watchlistCommand = this.commands.get('watchlist');
          if (watchlistCommand) {
            await interaction.deferReply();
            
            const simulatedMessage = {
              channel: interaction.channel,
              reply: async (options) => {
                await interaction.editReply(options);
              }
            };
            
            await watchlistCommand.execute(simulatedMessage, [], {
              apiClient: this.apiClient,
              dataManager: this.dataManager,
              orderbookWatcher: this.orderbookWatcher,
              matchNotificationWatcher: this.matchNotificationWatcher,
              matchResultWatcher: this.matchResultWatcher,
              polygonStalkerService: this.polygonStalkerService,
              encheresWatcher: this.encheresWatcher,
              clubNewsWatcher: this.clubNewsWatcher,
              gasTrackerService: this.gasTrackerService,
              clubFollowerWatcher: this.clubFollowerWatcher
            });
          }
        } catch (error) {
          logger.error('Erreur actualisation watchlist:', error);
          await interaction.reply({
            content: '❌ Erreur lors de l\'actualisation de la watchlist.',
            flags: 64 // Ephemeral flag
          });
        }
        break;
        
      default:
        await interaction.reply({ 
          content: '❌ Action watchlist non reconnue.', 
          flags: 64 // Ephemeral flag 
        });
    }
  }

  async handleStalkerButton(interaction, params) {
    const [action] = params;
    const channelId = interaction.channel.id;
    
    switch (action) {
      case 'stop':
      case 'all':
        // Arrêter toutes les surveillances stalker
        if (this.polygonStalkerService) {
          const stoppedCount = await this.polygonStalkerService.stopAllWatchingInChannel(channelId);
          await this.dataManager.save();
          
          if (stoppedCount > 0) {
            await interaction.reply({
              content: `✅ ${stoppedCount} surveillance(s) stalker arrêtée(s) avec succès.`,
              flags: 64 // Ephemeral flag
            });
          } else {
            await interaction.reply({
              content: '⚠️ Aucune surveillance stalker à arrêter.',
              flags: 64 // Ephemeral flag
            });
          }
        }
        break;
        
      default:
        await interaction.reply({ 
          content: '❌ Action stalker non reconnue.', 
          flags: 64 // Ephemeral flag 
        });
    }
  }

  async handleEncheresButton(interaction, params) {
    const [action] = params;
    const channelId = interaction.channel.id;
    
    switch (action) {
      case 'start':
        if (this.encheresWatcher) {
          this.encheresWatcher.enableWatching(channelId);
          await this.dataManager.save();
          
          await interaction.reply({
            content: '✅ Surveillance des enchères activée.',
            flags: 64 // Ephemeral flag
          });
        }
        break;
        
      case 'stop':
        if (this.encheresWatcher) {
          this.encheresWatcher.disableWatching(channelId);
          await this.dataManager.save();
          
          await interaction.reply({
            content: '✅ Surveillance des enchères arrêtée.',
            flags: 64 // Ephemeral flag
          });
        }
        break;
        
      case 'status':
        try {
          const encheresCommand = this.commands.get('encheres');
          if (encheresCommand) {
            await interaction.deferReply();
            
            const simulatedMessage = {
              channel: interaction.channel,
              reply: async (options) => {
                await interaction.editReply(options);
              }
            };
            
            await encheresCommand.execute(simulatedMessage, ['status'], {
              apiClient: this.apiClient,
              dataManager: this.dataManager,
              orderbookWatcher: this.orderbookWatcher,
              matchNotificationWatcher: this.matchNotificationWatcher,
              matchResultWatcher: this.matchResultWatcher,
              polygonStalkerService: this.polygonStalkerService,
              encheresWatcher: this.encheresWatcher,
              clubNewsWatcher: this.clubNewsWatcher,
              gasTrackerService: this.gasTrackerService,
              clubFollowerWatcher: this.clubFollowerWatcher
            });
          }
        } catch (error) {
          await interaction.reply({
            content: '❌ Erreur lors de l\'affichage du statut.',
            flags: 64 // Ephemeral flag
          });
        }
        break;
        
      default:
        await interaction.reply({ 
          content: '❌ Action enchères non reconnue.', 
          flags: 64 // Ephemeral flag 
        });
    }
  }

  async handleCompositionButton(interaction, params) {
    // params[0] = 'done', params[1] = clubId, params[2] = matchDate
    const subAction = params[0];
    const clubId = params[1];
    const matchDate = params[2];

    if (subAction !== 'done') {
      await interaction.reply({
        content: '❌ Action non reconnue.',
        flags: 64 // Ephemeral flag
      });
      return;
    }

    if (!clubId || !matchDate) {
      await interaction.reply({
        content: '❌ Données manquantes pour marquer la composition.',
        flags: 64 // Ephemeral flag
      });
      return;
    }

    try {
      // Vérifier si déjà marquée
      const alreadyCompleted = this.dataManager.isCompositionCompleted(clubId, matchDate);

      if (alreadyCompleted) {
        const completionData = this.dataManager.getCompletedComposition(clubId, matchDate);
        const completedBy = completionData.completedBy;
        await interaction.reply({
          content: `ℹ️ La composition pour ce match a déjà été marquée comme complétée ${completedBy ? `par <@${completedBy}>` : ''}.`,
          flags: 64 // Ephemeral flag
        });
        return;
      }

      // Marquer comme complétée
      this.dataManager.markCompositionCompleted(clubId, matchDate, interaction.user.id);
      await this.dataManager.save();

      // Désactiver le bouton dans le message original
      try {
        const disabledButton = new (require('discord.js').ButtonBuilder)()
          .setCustomId(`composition_done_${clubId}_${matchDate}`)
          .setLabel('✅ Composition faite')
          .setStyle(require('discord.js').ButtonStyle.Success)
          .setDisabled(true);

        const disabledRow = new (require('discord.js').ActionRowBuilder)()
          .addComponents(disabledButton);

        await interaction.update({
          components: [disabledRow]
        });

        logger.info(`✅ Composition marquée complétée: Club ${clubId}, Match ${matchDate} par ${interaction.user.id}`);
      } catch (updateError) {
        logger.error('Erreur mise à jour bouton:', updateError);
        // Répondre quand même même si la mise à jour du bouton échoue
        await interaction.reply({
          content: '✅ Composition marquée comme complétée ! Vous ne recevrez plus de rappels pour ce match.',
          flags: 64 // Ephemeral flag
        });
      }

    } catch (error) {
      logger.error('Erreur handleCompositionButton:', error);
      await interaction.reply({
        content: '❌ Une erreur est survenue lors du marquage de la composition.',
        flags: 64 // Ephemeral flag
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
