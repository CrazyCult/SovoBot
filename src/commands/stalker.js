const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'stalker',
  description: 'Surveiller les transactions de parts d\'un utilisateur Soccerverse',
  usage: '!stalker <username> [add|remove|list|status]',
  
  async execute(message, args, { apiClient, dataManager, polygonStalkerService }) {
    // Vérifier les permissions d'administrateur pour cette commande sensible
    if (!message.member || !message.member.permissions.has('ADMINISTRATOR')) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Permission refusée')
        .setDescription('Cette commande est réservée aux administrateurs du serveur.')
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const channelId = message.channel.id;

    // CORRECTION: Gérer les commandes spéciales en premier
    if (args.length === 1) {
      const command = args[0].toLowerCase();
      
      switch (command) {
        case 'list':
          await this.showWatchedUsers(message, channelId, { dataManager });
          return;
          
        case 'status':
          await this.showStalkerStatus(message, channelId, { dataManager, polygonStalkerService });
          return;
          
        default:
          // Si ce n'est pas une commande spéciale, traiter comme un nom d'utilisateur
          await this.addUserToWatch(message, args[0], channelId, { dataManager, apiClient, polygonStalkerService });
          return;
      }
    }

    // Si aucun argument, afficher l'aide
    if (args.length === 0) {
      await this.showHelp(message);
      return;
    }

    // CORRECTION: Nouveau parsing pour les commandes avec 2 arguments
    const username = args[0];
    const action = args[1]?.toLowerCase();

    switch (action) {
      case 'add':
        await this.addUserToWatch(message, username, channelId, { dataManager, apiClient, polygonStalkerService });
        break;
        
      case 'remove':
        await this.removeUserFromWatch(message, username, channelId, { dataManager, polygonStalkerService });
        break;
        
      default:
        // Par défaut, ajouter l'utilisateur
        await this.addUserToWatch(message, username, channelId, { dataManager, apiClient, polygonStalkerService });
    }
  },

  async addUserToWatch(message, username, channelId, { dataManager, apiClient, polygonStalkerService }) {
    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('🔍 Vérification utilisateur...')
      .setDescription(`Recherche de **${username}** dans Soccerverse...`)
      .addFields({
        name: '⏳ Progression',
        value: 'Connexion à l\'API Soccerverse...'
      })
      .setFooter({ text: 'Cette opération peut prendre quelques secondes' });

    const statusMessage = await message.reply({ embeds: [embed] });

    try {
      // Vérifier que l'utilisateur existe en récupérant ses transactions
      await this.validateAndInitializeUser(username, apiClient);
      
      // Récupérer les paramètres de surveillance du canal
      const settings = dataManager.getChannelSettings(channelId);
      const stalkerWatching = settings.stalkerWatching || {};
      
      // Vérifier si déjà surveillé
      if (stalkerWatching[username]) {
        const alreadyEmbed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('⚠️ Utilisateur déjà surveillé')
          .setDescription(`**${username}** est déjà dans la liste de surveillance.`)
          .addFields({
            name: '👤 Informations actuelles',
            value: `**Utilisateur:** ${username}\n**Depuis:** ${new Date(stalkerWatching[username].addedAt).toLocaleDateString('fr-FR')}`
          });
        
        await statusMessage.edit({ embeds: [alreadyEmbed] });
        return;
      }
      
      // Ajouter à la surveillance
      stalkerWatching[username] = {
        username: username,
        addedAt: Date.now(),
        lastTransactionId: null
      };
      
      dataManager.setChannelSettings(channelId, {
        stalkerWatching: stalkerWatching
      });
      
      await dataManager.save();
      
      const successEmbed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Surveillance activée !')
        .setDescription(`**${username}** est maintenant surveillé dans ce salon.`)
        .addFields(
          {
            name: '👤 Utilisateur',
            value: username,
            inline: true
          },
          {
            name: '📊 API',
            value: 'Soccerverse RPC',
            inline: true
          },
          {
            name: '⚡ Fréquence',
            value: 'Vérification toutes les 60s',
            inline: true
          },
          {
            name: '🔔 Notifications',
            value: 'Transactions de parts (achat/vente)\nMint de cartes NFT\nTransactions utilisateur',
            inline: false
          }
        )
        .setFooter({ 
          text: 'Les nouvelles transactions seront notifiées automatiquement • Soccerverse Bot v3.0' 
        })
        .setTimestamp();

      await statusMessage.edit({ embeds: [successEmbed] });
      
    } catch (error) {
      console.error('Erreur stalker:', error);
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription(`Impossible de trouver l'utilisateur **${username}** sur Soccerverse.`)
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        })
        .addFields({
          name: '💡 Solutions',
          value: '• Vérifiez l\'orthographe du nom d\'utilisateur\n• L\'utilisateur doit exister sur Soccerverse\n• Réessayez dans quelques instants'
        });
      
      await statusMessage.edit({ embeds: [errorEmbed] });
    }
  },

  async validateAndInitializeUser(username, apiClient) {
    try {
      // Utiliser l'API RPC pour vérifier que l'utilisateur existe
      const result = await apiClient.makeRpcRequest('get_user_share_transactions', {
        name: username
      });
      
      // Vérifier que l'utilisateur existe (même sans transactions)
      if (!result && result !== []) {
        throw new Error(`Utilisateur "${username}" introuvable`);
      }
      
      console.log(`✅ Utilisateur ${username} validé - ${Array.isArray(result) ? result.length : 0} transaction(s) trouvée(s)`);
      return true;
      
    } catch (error) {
      console.error(`❌ Validation utilisateur ${username} échouée:`, error);
      throw new Error(`Utilisateur "${username}" introuvable sur Soccerverse`);
    }
  },

  async removeUserFromWatch(message, username, channelId, { dataManager, polygonStalkerService }) {
    const settings = dataManager.getChannelSettings(channelId);
    const stalkerWatching = settings.stalkerWatching || {};
    
    if (!stalkerWatching[username]) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Utilisateur non surveillé')
        .setDescription(`**${username}** n'est pas dans la liste de surveillance de ce salon.`)
        .addFields({
          name: '📋 Voir la liste',
          value: 'Utilisez `!stalker list` pour voir tous les utilisateurs surveillés.'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }
    
    // Supprimer du service de surveillance
    if (polygonStalkerService) {
      polygonStalkerService.stopWatchingUser(channelId, username);
    }
    
    delete stalkerWatching[username];
    
    dataManager.setChannelSettings(channelId, {
      stalkerWatching: stalkerWatching
    });
    
    await dataManager.save();
    
    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('✅ Surveillance supprimée')
      .setDescription(`**${username}** a été retiré de la surveillance.`)
      .addFields({
        name: '🗑️ Action effectuée',
        value: 'Les transactions de cet utilisateur ne seront plus surveillées dans ce salon.'
      })
      .setTimestamp();
    
    await message.reply({ embeds: [embed] });
  },

  async showWatchedUsers(message, channelId, { dataManager }) {
    const settings = dataManager.getChannelSettings(channelId);
    const stalkerWatching = settings.stalkerWatching || {};
    
    const watchedUsers = Object.keys(stalkerWatching);
    
    if (watchedUsers.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('📋 Aucune surveillance active')
        .setDescription('Aucun utilisateur n\'est actuellement surveillé dans ce salon.')
        .addFields({
          name: '💡 Pour démarrer',
          value: '`!stalker <username>` pour ajouter un utilisateur à surveiller'
        })
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }
    
    const embed = new EmbedBuilder()
      .setColor('#9C27B0')
      .setTitle('👥 Utilisateurs surveillés')
      .setDescription(`**${watchedUsers.length}** utilisateur(s) surveillé(s) dans ce salon`)
      .setTimestamp();

    let usersList = '';
    watchedUsers.forEach((username, index) => {
      const userData = stalkerWatching[username];
      const addedDate = new Date(userData.addedAt).toLocaleDateString('fr-FR');
      
      usersList += `**${index + 1}.** 👤 **${username}**\n`;
      usersList += `   └ 📅 Ajouté le ${addedDate}\n\n`;
    });

    embed.addFields({
      name: '🔍 Liste des surveillances',
      value: usersList,
      inline: false
    });

    embed.addFields({
      name: '⚡ Configuration',
      value: '• **API:** Soccerverse RPC\n• **Fréquence:** Vérification toutes les 60 secondes\n• **Notifications:** Automatiques dans ce salon',
      inline: false
    });

    // Ajouter des boutons d'action
    const actionRow = new ActionRowBuilder();
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('stalker_stop_all')
        .setLabel('Arrêter toutes les surveillances')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔕')
    );

    await message.reply({ 
      embeds: [embed],
      components: [actionRow]
    });
  },

  async showStalkerStatus(message, channelId, { dataManager, polygonStalkerService }) {
    const settings = dataManager.getChannelSettings(channelId);
    const stalkerWatching = settings.stalkerWatching || {};
    const watchedUsersCount = Object.keys(stalkerWatching).length;
    
    const embed = new EmbedBuilder()
      .setColor('#2196F3')
      .setTitle('📊 Statut de la Surveillance Stalker')
      .setDescription('Système de surveillance des transactions Soccerverse')
      .addFields(
        {
          name: '👥 Statistiques',
          value: `**Utilisateurs surveillés:** ${watchedUsersCount}\n**API:** Soccerverse RPC\n**Méthode:** get_user_share_transactions`,
          inline: true
        },
        {
          name: '⚙️ Configuration',
          value: `**Fréquence:** 60 secondes\n**Types surveillés:** Parts, NFT, Transactions\n**Notifications:** Temps réel`,
          inline: true
        }
      );

    if (polygonStalkerService) {
      const stats = polygonStalkerService.getStalkerStats();
      embed.addFields({
        name: '📈 Statistiques globales',
        value: 
          `**Vérifications totales:** ${stats.stats.totalChecks}\n` +
          `**Taux de succès:** ${stats.stats.successRate}\n` +
          `**Erreurs consécutives:** ${stats.consecutiveErrors}\n` +
          `**Uptime:** ${stats.stats.uptime}`,
        inline: false
      });
    }

    if (watchedUsersCount > 0) {
      let recentActivity = '';
      const users = Object.entries(stalkerWatching);
      
      for (const [username, data] of users.slice(0, 3)) {
        const addedDate = new Date(data.addedAt).toLocaleDateString('fr-FR');
        recentActivity += `• **${username}** - ${addedDate}\n`;
      }
      
      if (users.length > 3) {
        recentActivity += `... et ${users.length - 3} autre(s)`;
      }
      
      embed.addFields({
        name: '📋 Utilisateurs récents',
        value: recentActivity,
        inline: false
      });
    }

    embed.setFooter({ 
      text: 'Service actif 24/7 • Soccerverse Bot v3.0' 
    })
    .setTimestamp();

    await message.reply({ embeds: [embed] });
  },

  async showHelp(message) {
    const embed = new EmbedBuilder()
      .setColor('#9C27B0')
      .setTitle('👥 Commande Stalker - Surveillance Soccerverse')
      .setDescription('Surveillez les transactions de parts des utilisateurs Soccerverse')
      .addFields(
        {
          name: '📝 Commandes disponibles',
          value: 
            '**`!stalker <username>`** - Ajouter un utilisateur à surveiller\n' +
            '**`!stalker <username> remove`** - Arrêter la surveillance\n' +
            '**`!stalker list`** - Liste des utilisateurs surveillés\n' +
            '**`!stalker status`** - Statut du système de surveillance',
          inline: false
        },
        {
          name: '💡 Exemples d\'utilisation',
          value: 
            '`!stalker CrazyCult` - Surveiller CrazyCult\n' +
            '`!stalker GamblerTheOne` - Surveiller GamblerTheOne\n' +
            '`!stalker CrazyCult remove` - Arrêter surveillance\n' +
            '`!stalker list` - Voir tous les utilisateurs surveillés',
          inline: false
        },
        {
          name: '🔧 Fonctionnement',
          value: 
            '• **API:** Soccerverse RPC (get_user_share_transactions)\n' +
            '• **Surveillance temps réel:** Vérification toutes les 60 secondes\n' +
            '• **Notifications:** Alerte Discord pour chaque nouvelle transaction\n' +
            '• **Types surveillés:** Achat/vente de parts, mint NFT, transactions utilisateur',
          inline: false
        },
        {
          name: '📊 Types de transactions surveillées',
          value: 
            '• **share trade** - Achat/vente de parts de club\n' +
            '• **mint** - Création de cartes NFT\n' +
            '• **user tx** - Autres transactions utilisateur\n' +
            '• **Avec détails:** Montant, date, type, partenaire de transaction',
          inline: false
        },
        {
          name: '⚠️ Informations importantes',
          value: 
            '• Commande réservée aux administrateurs\n' +
            '• Nécessite un nom d\'utilisateur valide sur Soccerverse\n' +
            '• Les données sont sauvegardées par salon Discord\n' +
            '• Plus fiable que la surveillance blockchain',
          inline: false
        }
      )
      .setFooter({ text: 'Version améliorée avec API Soccerverse • Soccerverse Bot v3.0' });

    await message.reply({ embeds: [embed] });
  }
};
