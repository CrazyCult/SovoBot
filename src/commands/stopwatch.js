const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'stopwatch',
  description: 'Arrêter rapidement les surveillances orderbook (commande secrète)',
  usage: '!stopwatch [club_id]',
  
  async execute(message, args, { apiClient, dataManager, orderbookWatcher }) {
    const channelId = message.channel.id;
    const clubId = args[0] ? parseInt(args[0]) : null;

    // Si ID spécifié, arrêter surveillance spécifique
    if (clubId) {
      return await this.stopSpecificWatch(message, clubId, { dataManager, orderbookWatcher });
    }
    
    // Sinon, arrêter toutes les surveillances
    return await this.stopAllWatches(message, { dataManager, orderbookWatcher });
  },

  async stopSpecificWatch(message, clubId, { dataManager, orderbookWatcher }) {
    const channelId = message.channel.id;
    
    if (isNaN(clubId)) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ ID invalide')
        .setDescription('L\'ID du club doit être un nombre.')
        .addFields({
          name: 'Exemples valides',
          value: '`!stopwatch 2180` - Arrêter surveillance du club 2180\n`!stopwatch` - Arrêter toutes les surveillances'
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

    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('✅ Surveillance arrêtée')
      .setDescription(`Surveillance du club **#${clubId}** désactivée.`)
      .setFooter({ text: 'Commande rapide exécutée avec succès' })
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
        .addFields({
          name: '💡 Démarrer une surveillance',
          value: '`!orderbook <club_id> <prix_min> <prix_max>`'
        });
      
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
      .setTitle('🔕 Toutes les surveillances arrêtées')
      .setDescription(`**${activeWatches.length}** surveillance(s) désactivée(s) rapidement.`)
      .addFields({
        name: '⚡ Résumé',
        value: `${activeWatches.length} club(s) ne sont plus surveillés dans ce salon.`,
        inline: false
      })
      .setFooter({ text: 'Commande rapide • Soccerverse Bot v3.0' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
};
