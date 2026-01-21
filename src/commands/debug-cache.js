const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'debug-cache',
  description: 'Voir l\'état du cache des matchs (admin)',
  usage: '!debug-cache',
  
  async execute(message, args, { dataManager, matchResultWatcher, matchNotificationWatcher }) {
    // Vérifier les permissions d'administrateur
    if (!message.member || !message.member.permissions.has('ADMINISTRATOR')) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Permission refusée')
        .setDescription('Cette commande est réservée aux administrateurs du serveur.')
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#2196F3')
      .setTitle('🔍 Debug Cache des Matchs')
      .setDescription('État détaillé du système de cache');

    // Clubs inscrits
    const registeredClubs = dataManager.getAllRegisteredClubs();
    embed.addFields({
      name: '📋 Clubs inscrits',
      value: `**Total:** ${registeredClubs.length}\n**IDs:** ${registeredClubs.join(', ')}`,
      inline: false
    });

    // MatchResultWatcher
    if (matchResultWatcher) {
      const cacheSize = matchResultWatcher.upcomingMatchesCache ? matchResultWatcher.upcomingMatchesCache.size : 0;
      const lastUpdate = matchResultWatcher.lastCacheUpdate 
        ? new Date(matchResultWatcher.lastCacheUpdate).toLocaleString('fr-FR')
        : 'Jamais';
      
      let cacheDetails = `**Clubs en cache:** ${cacheSize}\n**Dernière MAJ:** ${lastUpdate}\n`;
      
      if (matchResultWatcher.upcomingMatchesCache && cacheSize > 0) {
        cacheDetails += `\n**Détails du cache:**\n`;
        for (const [clubId, matches] of matchResultWatcher.upcomingMatchesCache.entries()) {
          const clubName = dataManager.apiClient?.getClubName(clubId) || `Club ${clubId}`;
          cacheDetails += `• ${clubName}: ${matches.length} match(s)\n`;
          
          // Afficher les matchs
          matches.forEach((match, index) => {
            const matchDate = new Date(match.date * 1000).toLocaleString('fr-FR');
            cacheDetails += `  ${index + 1}. ${matchDate}\n`;
          });
        }
      } else {
        cacheDetails += '\n⚠️ **Cache vide !**';
      }
      
      embed.addFields({
        name: '🏆 MatchResultWatcher',
        value: cacheDetails.substring(0, 1024),
        inline: false
      });
    } else {
      embed.addFields({
        name: '🏆 MatchResultWatcher',
        value: '❌ Non initialisé',
        inline: false
      });
    }

    // MatchNotificationWatcher
    if (matchNotificationWatcher) {
      const scheduledCount = matchNotificationWatcher.scheduledNotifications?.size || 0;
      const sentCount = matchNotificationWatcher.sentNotifications?.size || 0;
      
      embed.addFields({
        name: '🔔 MatchNotificationWatcher',
        value: 
          `**Notifications programmées:** ${scheduledCount}\n` +
          `**Notifications envoyées (cache):** ${sentCount}\n` +
          `**Référence au cache:** ${matchNotificationWatcher.matchResultWatcher ? '✅ OK' : '❌ Manquante'}`,
        inline: false
      });
    } else {
      embed.addFields({
        name: '🔔 MatchNotificationWatcher',
        value: '❌ Non initialisé',
        inline: false
      });
    }

    // Recommandations
    let recommendations = '';
    if (!matchResultWatcher || !matchResultWatcher.upcomingMatchesCache || matchResultWatcher.upcomingMatchesCache.size === 0) {
      recommendations += '⚠️ Le cache est vide ! Lance `!notifications test` pour le mettre à jour.\n';
    }
    if (matchNotificationWatcher && !matchNotificationWatcher.matchResultWatcher) {
      recommendations += '⚠️ La référence au cache est manquante ! Vérifie l\'initialisation dans index.js.\n';
    }
    if (registeredClubs.length === 0) {
      recommendations += '⚠️ Aucun club inscrit ! Utilise `!inscription <club_id>` d\'abord.\n';
    }

    if (recommendations) {
      embed.addFields({
        name: '💡 Recommandations',
        value: recommendations,
        inline: false
      });
    } else {
      embed.addFields({
        name: '✅ Système',
        value: 'Tout semble en ordre !',
        inline: false
      });
    }

    embed.setTimestamp();
    await message.reply({ embeds: [embed] });
  }
};
