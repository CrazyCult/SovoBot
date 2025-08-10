const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'watchlist',
  description: 'Gérer les surveillances orderbook actives (commande secrète)',
  usage: '!watchlist [stop] [club_id]',
  
  async execute(message, args, { apiClient, dataManager, orderbookWatcher }) {
    const channelId = message.channel.id;
    const action = args[0]?.toLowerCase();
    const clubId = args[1] ? parseInt(args[1]) : null;

    // Si aucun argument, afficher toutes les surveillances
    if (args.length === 0) {
      return await this.showWatchlist(message, { apiClient, dataManager });
    }

    // Commande stop
    if (action === 'stop') {
      if (clubId) {
        // Arrêter surveillance d'un club spécifique
        return await this.stopSpecificWatch(message, clubId, { dataManager, orderbookWatcher });
      } else {
        // Arrêter toutes les surveillances
        return await this.stopAllWatches(message, { dataManager, orderbookWatcher });
      }
    }

    // Commande inconnue
    const embed = new EmbedBuilder()
      .setColor('#FF6B6B')
      .setTitle('❌ Commande invalide')
      .setDescription('Usage de la commande watchlist :')
      .addFields({
        name: '📋 Commandes disponibles',
        value: 
          '• `!watchlist` - Afficher toutes les surveillances actives\n' +
          '• `!watchlist stop` - Arrêter toutes les surveillances\n' +
          '• `!watchlist stop <club_id>` - Arrêter surveillance d\'un club spécifique',
        inline: false
      })
      .setFooter({ text: 'Commande secrète • Soccerverse Bot v3.0' });
    
    await message.reply({ embeds: [embed] });
  },

  async showWatchlist(message, { apiClient, dataManager }) {
    const channelId = message.channel.id;
    const settings = dataManager.getChannelSettings(channelId);
    const orderbookWatching = settings.orderbookWatching || {};

    // Filtrer les surveillances actives
    const activeWatches = Object.entries(orderbookWatching)
      .filter(([clubId, config]) => config.enabled)
      .map(([clubId, config]) => ({
        clubId: parseInt(clubId),
        ...config
      }));

    if (activeWatches.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('📋 Aucune surveillance active')
        .setDescription('Ce salon n\'a aucune surveillance orderbook en cours.')
        .addFields({
          name: '💡 Pour démarrer une surveillance',
          value: '`!orderbook <club_id> <prix_min> <prix_max>`'
        })
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    // Créer l'embed principal
    const embed = new EmbedBuilder()
      .setColor('#9B59B6')
      .setTitle('📊 Surveillances Orderbook Actives')
      .setDescription(`**${activeWatches.length}** surveillance(s) en cours dans ce salon`)
      .setTimestamp();

    // Ajouter chaque surveillance
    let watchList = '';
    for (let i = 0; i < activeWatches.length; i++) {
      const watch = activeWatches[i];
      const clubName = apiClient.getClubName(watch.clubId);
      
      let criteria = '';
      if (watch.minPrice !== undefined) {
        criteria += `Min: ${(watch.minPrice / 10000).toLocaleString()}$ `;
      }
      if (watch.maxPrice !== undefined) {
        criteria += `Max: ${(watch.maxPrice / 10000).toLocaleString()}$`;
      }
      
      const startedDate = watch.startedAt ? 
        new Date(watch.startedAt).toLocaleDateString('fr-FR') : 
        'Inconnue';
      
      watchList += `**${i + 1}.** 🏟️ **${clubName}** (#${watch.clubId})\n`;
      watchList += `   └ 🔍 ${criteria.trim()}\n`;
      watchList += `   └ 📅 Depuis le ${startedDate}\n\n`;
    }

    embed.addFields({
      name: '🔍 Clubs surveillés',
      value: watchList || 'Aucune surveillance',
      inline: false
    });

    // Ajouter des statistiques
    const totalClubs = activeWatches.length;
    const avgPriceRanges = activeWatches
      .filter(w => w.minPrice && w.maxPrice)
      .map(w => (w.maxPrice - w.minPrice) / 10000);
    const avgRange = avgPriceRanges.length > 0 ? 
      Math.round(avgPriceRanges.reduce((a, b) => a + b, 0) / avgPriceRanges.length) : 0;

    embed.addFields({
      name: '📊 Statistiques',
      value: 
        `**Total surveillances :** ${totalClubs}\n` +
        `**Vérification :** Toutes les 5 minutes\n` +
        `**Fourchette moyenne :** ${avgRange > 0 ? avgRange.toLocaleString() + '$' : 'Variable'}`,
      inline: false
    });

    // Ajouter des boutons d'action
    const actionRow = new ActionRowBuilder();
    
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('watchlist_stop_all')
        .setLabel('Arrêter toutes les surveillances')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔕'),
      new ButtonBuilder()
        .setCustomId('watchlist_refresh')
        .setLabel('Actualiser')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄')
    );

    await message.reply({ 
      embeds: [embed],
      components: [actionRow]
    });
  },

  async stopSpecificWatch(message, clubId, { dataManager, orderbookWatcher }) {
    const channelId = message.channel.id;
    
    if (isNaN(clubId)) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ ID invalide')
        .setDescription('L\'ID du club doit être un nombre.')
        .addFields({
          name: 'Exemple valide',
          value: '`!watchlist stop 2180`'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const settings = dataManager.getChannelSettings(channelId);
    const orderbookWatching = settings.orderbookWatching || {};

    if (!orderbookWatching[clubId] || !orderbookWatching[clubId].enabled) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Aucune surveillance')
        .setDescription(`Le club **#${clubId}** n'est pas surveillé dans ce salon.`)
        .addFields({
          name: '📋 Voir les surveillances actives',
          value: '`!watchlist`'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    // Arrêter la surveillance
    if (orderbookWatcher) {
      orderbookWatcher.disableWatching(channelId, clubId);
    }
    await dataManager.save();

    const clubName = dataManager.apiClient ? 
      dataManager.apiClient.getClubName(clubId) : 
      `Club #${clubId}`;

    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('✅ Surveillance arrêtée')
      .setDescription(`La surveillance orderbook de **${clubName}** a été désactivée.`)
      .addFields({
        name: '📊 Club',
        value: `${clubName} (#${clubId})`,
        inline: true
      })
      .setFooter({ 
        text: 'Pour redémarrer : !orderbook ' + clubId + ' <min> <max>' 
      })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  },

  async stopAllWatches(message, { dataManager, orderbookWatcher }) {
    const channelId = message.channel.id;
    const settings = dataManager.getChannelSettings(channelId);
    const orderbookWatching = settings.orderbookWatching || {};

    // Compter les surveillances actives
    const activeWatches = Object.entries(orderbookWatching)
      .filter(([clubId, config]) => config.enabled);

    if (activeWatches.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Aucune surveillance active')
        .setDescription('Ce salon n\'a aucune surveillance orderbook à arrêter.')
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    // Arrêter toutes les surveillances
    for (const [clubId, config] of activeWatches) {
      if (orderbookWatcher) {
        orderbookWatcher.disableWatching(channelId, parseInt(clubId));
      }
    }
    await dataManager.save();

    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('✅ Toutes les surveillances arrêtées')
      .setDescription(`**${activeWatches.length}** surveillance(s) orderbook ont été désactivées dans ce salon.`)
      .addFields({
        name: '🔕 Clubs désactivés',
        value: activeWatches.map(([clubId]) => `• Club #${clubId}`).join('\n') || 'Aucun',
        inline: false
      })
      .setFooter({ 
        text: 'Pour redémarrer une surveillance : !orderbook <club_id> <min> <max>' 
      })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
};
