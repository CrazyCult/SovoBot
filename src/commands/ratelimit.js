const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'ratelimit',
  description: 'Afficher les statistiques du Rate Limiter (admin)',
  usage: '!ratelimit [reset|clear]',
  
  async execute(message, args, { apiClient }) {
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

    const action = args[0]?.toLowerCase();

    if (action === 'reset') {
      apiClient.resetRateLimiterStats();
      
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Statistiques réinitialisées')
        .setDescription('Les statistiques du Rate Limiter ont été réinitialisées.')
        .setFooter({ text: 'Soccerverse Bot v3.0' })
        .setTimestamp();
      
      await message.reply({ embeds: [embed] });
      return;
    }

    if (action === 'clear') {
      const count = apiClient.clearRateLimiterQueue();
      
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('🗑️ Queue vidée')
        .setDescription(`**${count}** requête(s) en attente ont été annulées.`)
        .setFooter({ text: 'Soccerverse Bot v3.0' })
        .setTimestamp();
      
      await message.reply({ embeds: [embed] });
      return;
    }

    // Afficher les stats
    const stats = apiClient.getRateLimiterStats();
    
    const embed = new EmbedBuilder()
      .setColor('#9B59B6')
      .setTitle('⏱️ Statistiques Rate Limiter')
      .setDescription(`Limite globale: **${stats.maxRate} requêtes/seconde**`)
      .addFields(
        {
          name: '📊 Activité en Temps Réel',
          value: 
            `**Taux actuel:** ${stats.currentRate}/${stats.maxRate} req/s (${stats.utilization})\n` +
            `**File d'attente:** ${stats.currentQueueSize} requête(s)`,
          inline: false
        },
        {
          name: '📈 Statistiques Totales',
          value: 
            `**Total requêtes:** ${stats.totalRequests.toLocaleString()}\n` +
            `**Requêtes en queue:** ${stats.queuedRequests.toLocaleString()}\n` +
            `**Max queue size:** ${stats.maxQueueSize}`,
          inline: true
        },
        {
          name: '🎯 Performance',
          value: 
            `**Utilisation:** ${stats.utilization}\n` +
            `**Requêtes rejetées:** ${stats.rejectedRequests}`,
          inline: true
        }
      )
      .addFields({
        name: '💡 Commandes Disponibles',
        value: 
          '`!ratelimit` - Voir les stats\n' +
          '`!ratelimit reset` - Réinitialiser les stats\n' +
          '`!ratelimit clear` - Vider la queue',
        inline: false
      })
      .setFooter({ text: 'Soccerverse Bot v3.0' })
      .setTimestamp();
    
    await message.reply({ embeds: [embed] });
  }
};
