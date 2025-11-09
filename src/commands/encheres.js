const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'encheres',
  description: 'Surveiller les enchères de transferts de vos clubs inscrits ou de joueurs spécifiques',
  usage: '!encheres [player_id] [start|stop|status|list|remove]',
  
  async execute(message, args, { apiClient, dataManager, encheresWatcher }) {
    const channelId = message.channel.id;
    const action = args[0]?.toLowerCase();

    // Si premier argument est un nombre, c'est un ID de joueur
    if (args.length > 0 && !isNaN(args[0])) {
      const playerId = parseInt(args[0]);
      const subAction = args[1]?.toLowerCase();
      
      if (subAction === 'remove') {
        return await this.removePlayerFromWatch(message, playerId, channelId, { dataManager, apiClient });
      }
      
      return await this.addPlayerToWatch(message, playerId, channelId, { dataManager, apiClient });
    }

    // Commandes spéciales
    switch (action) {
      case 'start':
        await this.startWatching(message, channelId, { dataManager, encheresWatcher, apiClient });
        break;

      case 'stop':
        await this.stopWatching(message, channelId, { dataManager, encheresWatcher, apiClient });
        break;

      case 'status':
        await this.showStatus(message, channelId, { dataManager, encheresWatcher, apiClient });
        break;

      case 'list':
        await this.showWatchedAuctions(message, channelId, { dataManager, apiClient });
        break;

      default:
        // Si aucun argument, démarrer la surveillance pour les clubs inscrits
        await this.startWatching(message, channelId, { dataManager, encheresWatcher, apiClient });
    }
  },

  async startWatching(message, channelId, { dataManager, encheresWatcher, apiClient }) {
    const registeredClubs = dataManager.getChannelClubs(channelId);
    
    if (registeredClubs.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('📋 Aucun club inscrit')
        .setDescription('Ce salon n\'a aucun club inscrit aux notifications.')
        .addFields({
          name: '💡 Pour commencer',
          value: '• `!inscription <club_id>` - Inscrire un club\n• `!encheres <player_id>` - Surveiller un joueur spécifique'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    // Vérifier si déjà actif
    const settings = dataManager.getChannelSettings(channelId);
    if (settings.encheresWatching && settings.encheresWatching.enabled) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Surveillance déjà active')
        .setDescription('La surveillance des enchères est déjà en cours dans ce salon.')
        .addFields({
          name: '📊 Commandes disponibles',
          value: '• `!encheres status` - Voir le statut\n• `!encheres list` - Voir les enchères surveillées\n• `!encheres stop` - Arrêter la surveillance'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    // Activer la surveillance
    const encheresWatching = {
      enabled: true,
      startedBy: message.author.id,
      startedAt: Date.now(),
      clubs: registeredClubs.map(id => parseInt(id)),
      players: settings.encheresWatching?.players || [],
      notificationTimes: [30, 15, 5, 1],
      lastCheck: null
    };

    dataManager.setChannelSettings(channelId, {
      encheresWatching: encheresWatching
    });
    
    await dataManager.save();

    // Démarrer la surveillance si le service existe
    if (encheresWatcher) {
      encheresWatcher.enableWatching(channelId);
    }

    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('🏆 Surveillance des Enchères Activée !')
      .setDescription(`Surveillance démarrée par <@${message.author.id}>`)
      .addFields(
        {
          name: '🏟️ Clubs surveillés',
          value: registeredClubs.map(id => apiClient.getClubName(parseInt(id))).join('\n') || 'Aucun',
          inline: true
        },
        {
          name: '👤 Joueurs spécifiques',
          value: encheresWatching.players.length > 0 ? 
            encheresWatching.players.map(id => apiClient.getPlayerName(id)).join('\n') : 
            'Aucun',
          inline: true
        },
        {
          name: '⚙️ Configuration',
          value: '• **Fréquence:** Toutes les 60 secondes\n• **Notifications:** Dépassements + fins imminentes\n• **Intervalles:** 30, 15, 5, 1 minutes avant fin',
          inline: false
        }
      )
      .setFooter({ 
        text: 'Vous recevrez des notifications dans ce salon • Soccerverse Bot v3.0' 
      })
      .setTimestamp();

    // Ajouter des boutons d'action
    const actionRow = new ActionRowBuilder();
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('encheres_stop')
        .setLabel('Arrêter la surveillance')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔕'),
      new ButtonBuilder()
        .setCustomId('encheres_status')
        .setLabel('Voir le statut')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📊')
    );

    await message.reply({ 
      embeds: [embed],
      components: [actionRow]
    });
  },

  async stopWatching(message, channelId, { dataManager, encheresWatcher, apiClient }) {
    const settings = dataManager.getChannelSettings(channelId);
    
    if (!settings.encheresWatching || !settings.encheresWatching.enabled) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Aucune surveillance active')
        .setDescription('La surveillance des enchères n\'est pas en cours dans ce salon.')
        .addFields({
          name: '💡 Pour démarrer',
          value: '`!encheres` - Démarrer la surveillance'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    // Arrêter la surveillance
    if (encheresWatcher) {
      encheresWatcher.disableWatching(channelId);
    }

    // Mettre à jour les paramètres
    const updatedSettings = { ...settings };
    updatedSettings.encheresWatching.enabled = false;
    updatedSettings.encheresWatching.stoppedAt = Date.now();
    updatedSettings.encheresWatching.stoppedBy = message.author.id;
    
    dataManager.setChannelSettings(channelId, updatedSettings);
    await dataManager.save();

    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('✅ Surveillance Arrêtée')
      .setDescription(`Surveillance des enchères arrêtée par <@${message.author.id}>`)
      .addFields({
        name: '📊 Résumé',
        value: 'Les notifications d\'enchères ne seront plus envoyées dans ce salon.',
        inline: false
      })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  },

  async addPlayerToWatch(message, playerId, channelId, { dataManager, apiClient }) {
    try {
      // Vérifier que le joueur existe
      const playerName = apiClient.getPlayerName(playerId);
      
      const settings = dataManager.getChannelSettings(channelId);
      const encheresWatching = settings.encheresWatching || {
        enabled: false,
        clubs: [],
        players: [],
        notificationTimes: [30, 15, 5, 1]
      };

      // Vérifier si déjà surveillé
      if (encheresWatching.players.includes(playerId)) {
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('⚠️ Joueur déjà surveillé')
          .setDescription(`**${playerName}** est déjà dans la liste de surveillance.`)
          .addFields({
            name: '📋 Voir la liste',
            value: '`!encheres list` pour voir tous les joueurs surveillés'
          });
        
        await message.reply({ embeds: [embed] });
        return;
      }

      // Ajouter le joueur
      encheresWatching.players.push(playerId);
      
      dataManager.setChannelSettings(channelId, {
        encheresWatching: encheresWatching
      });
      
      await dataManager.save();

      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Joueur Ajouté à la Surveillance')
        .setDescription(`**${playerName}** (#${playerId}) est maintenant surveillé.`)
        .addFields(
          {
            name: '👤 Joueur',
            value: `[${playerName}](https://play.soccerverse.com/player/${playerId})`,
            inline: true
          },
          {
            name: '🔔 Notifications',
            value: 'Enchères actives\nDépassements\nFins imminentes',
            inline: true
          }
        )
        .setFooter({ 
          text: 'Utilisez !encheres pour démarrer la surveillance si elle n\'est pas active' 
        })
        .setTimestamp();

      await message.reply({ embeds: [embed] });

    } catch (error) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription(`Impossible d'ajouter le joueur #${playerId} à la surveillance.`)
        .addFields({
          name: '💡 Vérifications',
          value: '• L\'ID du joueur doit être valide\n• Le joueur doit exister dans Soccerverse'
        });
      
      await message.reply({ embeds: [embed] });
    }
  },

  async removePlayerFromWatch(message, playerId, channelId, { dataManager, apiClient }) {
    try {
      const settings = dataManager.getChannelSettings(channelId);
      const encheresWatching = settings.encheresWatching;
      
      if (!encheresWatching || !encheresWatching.players || !encheresWatching.players.includes(playerId)) {
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('⚠️ Joueur non surveillé')
          .setDescription(`Le joueur #${playerId} n'est pas dans la liste de surveillance.`)
          .addFields({
            name: '📋 Voir la liste',
            value: '`!encheres list` pour voir tous les joueurs surveillés'
          });
        
        await message.reply({ embeds: [embed] });
        return;
      }

      const playerName = apiClient.getPlayerName(playerId);
      const playerIndex = encheresWatching.players.indexOf(playerId);
      encheresWatching.players.splice(playerIndex, 1);
      
      dataManager.setChannelSettings(channelId, {
        encheresWatching: encheresWatching
      });
      
      await dataManager.save();

      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Joueur Retiré de la Surveillance')
        .setDescription(`**${playerName}** (#${playerId}) a été retiré de la surveillance des enchères.`)
        .addFields({
          name: '📊 Statut',
          value: 'Vous ne recevrez plus de notifications pour ce joueur.',
          inline: false
        })
        .setTimestamp();

      await message.reply({ embeds: [embed] });

    } catch (error) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription(`Impossible de retirer le joueur #${playerId} de la surveillance.`)
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        });
      
      await message.reply({ embeds: [embed] });
    }
  },

  async showStatus(message, channelId, { dataManager, encheresWatcher, apiClient }) {
    const settings = dataManager.getChannelSettings(channelId);
    const encheresWatching = settings.encheresWatching;
    
    if (!encheresWatching) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('📊 Aucune Configuration')
        .setDescription('La surveillance des enchères n\'a jamais été configurée dans ce salon.')
        .addFields({
          name: '💡 Pour commencer',
          value: '`!encheres` - Configurer et démarrer la surveillance'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const isActive = encheresWatching.enabled;
    const startedDate = encheresWatching.startedAt ? new Date(encheresWatching.startedAt) : null;
    const lastCheckDate = encheresWatching.lastCheck ? new Date(encheresWatching.lastCheck) : null;

    const embed = new EmbedBuilder()
      .setColor(isActive ? '#4CAF50' : '#6B7280')
      .setTitle('📊 Statut de la Surveillance des Enchères')
      .setDescription(`**État:** ${isActive ? '🟢 Active' : '🔴 Inactive'}`)
      .addFields(
        {
          name: '⚙️ Configuration',
          value: 
            `**Clubs surveillés:** ${encheresWatching.clubs?.length || 0}\n` +
            `**Joueurs spécifiques:** ${encheresWatching.players?.length || 0}\n` +
            `**Intervalles de notification:** ${encheresWatching.notificationTimes?.join(', ') || '30, 15, 5, 1'} minutes`,
          inline: true
        },
        {
          name: '📈 Statistiques',
          value: 
            `**Démarrée le:** ${startedDate ? startedDate.toLocaleDateString('fr-FR') : 'Jamais'}\n` +
            `**Dernière vérification:** ${lastCheckDate ? lastCheckDate.toLocaleTimeString('fr-FR') : 'Jamais'}\n` +
            `**Démarrée par:** ${encheresWatching.startedBy ? `<@${encheresWatching.startedBy}>` : 'Inconnu'}`,
          inline: true
        }
      );

    if (encheresWatcher) {
      const watcherStats = encheresWatcher.getEncheresStats();
      embed.addFields({
        name: '🔧 Service',
        value: 
          `**Statut du service:** ${watcherStats.active ? '✅ Opérationnel' : '❌ Hors ligne'}\n` +
          `**Canaux surveillés:** ${watcherStats.watchedChannels}\n` +
          `**Vérifications totales:** ${watcherStats.totalChecks}`,
        inline: false
      });
    }

    embed.setFooter({ 
      text: 'Soccerverse Bot v3.0' 
    })
    .setTimestamp();

    await message.reply({ embeds: [embed] });
  },

  async showWatchedAuctions(message, channelId, { dataManager, apiClient }) {
    const settings = dataManager.getChannelSettings(channelId);
    const encheresWatching = settings.encheresWatching;
    
    if (!encheresWatching || (!encheresWatching.clubs?.length && !encheresWatching.players?.length)) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('📋 Aucune Surveillance Configurée')
        .setDescription('Aucun club ou joueur n\'est configuré pour la surveillance.')
        .addFields({
          name: '💡 Configuration',
          value: '• `!inscription <club_id>` - Inscrire un club\n• `!encheres <player_id>` - Surveiller un joueur\n• `!encheres` - Démarrer la surveillance'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#2196F3')
      .setTitle('📋 Configuration de Surveillance des Enchères')
      .setDescription(`**État:** ${encheresWatching.enabled ? '🟢 Active' : '🔴 Inactive'}`)
      .setTimestamp();

    // Clubs surveillés
    if (encheresWatching.clubs?.length > 0) {
      let clubsList = '';
      encheresWatching.clubs.forEach((clubId, index) => {
        const clubName = apiClient.getClubName(clubId);
        clubsList += `**${index + 1}.** 🏟️ [${clubName}](https://play.soccerverse.com/club/${clubId}) (#${clubId})\n`;
      });

      embed.addFields({
        name: `🏟️ Clubs Surveillés (${encheresWatching.clubs.length})`,
        value: clubsList,
        inline: false
      });
    }

    // Joueurs surveillés
    if (encheresWatching.players?.length > 0) {
      let playersList = '';
      encheresWatching.players.forEach((playerId, index) => {
        const playerName = apiClient.getPlayerName(playerId);
        playersList += `**${index + 1}.** 👤 [${playerName}](https://play.soccerverse.com/player/${playerId}) (#${playerId})\n`;
        playersList += `   └ \`!encheres ${playerId} remove\` pour retirer\n`;
      });

      embed.addFields({
        name: `👤 Joueurs Spécifiques (${encheresWatching.players.length})`,
        value: playersList,
        inline: false
      });
    }

    // Configuration des notifications
    embed.addFields({
      name: '🔔 Notifications Configurées',
      value: 
        `**Types:** Dépassements d'enchères + Fins imminentes\n` +
        `**Intervalles:** ${encheresWatching.notificationTimes?.join(', ') || '30, 15, 5, 1'} minutes avant fin\n` +
        `**Fréquence de vérification:** Toutes les 60 secondes`,
      inline: false
    });

    // Ajouter des boutons d'action
    const actionRow = new ActionRowBuilder();
    
    if (encheresWatching.enabled) {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId('encheres_stop')
          .setLabel('Arrêter')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔕')
      );
    } else {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId('encheres_start')
          .setLabel('Démarrer')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🚀')
      );
    }

    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('encheres_status')
        .setLabel('Statut Détaillé')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📊')
    );

    await message.reply({ 
      embeds: [embed],
      components: [actionRow]
    });
  }
};
