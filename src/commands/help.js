const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'help',
  description: 'Afficher l\'aide du bot',
  usage: '!help',
  
  async execute(message, args, { apiClient, dataManager }) {
    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('🤖 Soccerverse Bot v3.0 - Aide')
      .setDescription('Bot Discord pour suivre vos clubs Soccerverse favoris !')
      .addFields(
        {
          name: '📝 Commandes principales',
          value: 
            '**`!inscription <club_id>`** - S\'inscrire aux notifications d\'un club\n' +
            '**`!desinscription [club_id]`** - Se désinscrire des notifications\n' +
            '**`!club [id|nom]`** - Voir les infos d\'un club ou des clubs inscrits\n' +
            '**`!matchs [club_id]`** - Voir les matchs d\'un club (dernier et prochain)\n' +
            '**`!calendrier [club_id]`** - Voir le calendrier des prochains matchs\n' +
            '**`!classement [club_id]`** - Voir le classement de la ligue\n' +
            '**`!help`** - Afficher cette aide',
          inline: false
        },
        {
          name: '⚙️ Commandes admin',
          value: 
            '**`!notifications [status|test|reset]`** - Gérer les notifications (admin)\n' +
            '**`!update`** - Mettre à jour les mappings (admin)\n' +
            '**`!reload <commande>`** - Recharger une commande (admin)',
          inline: false
        },
        {
          name: '💡 Exemples d\'utilisation',
          value: 
            '`!inscription 2180` - S\'inscrire au club ID 2180\n' +
            '`!club 2180` - Voir les infos du club ID 2180\n' +
            '`!club Arsenal` - Rechercher des clubs nommés "Arsenal"\n' +
            '`!club` - Voir tous les clubs inscrits dans ce salon\n' +
            '`!matchs` - Voir les matchs du club inscrit\n' +
            '`!calendrier 2180 10` - Voir 10 prochains matchs du club\n' +
            '`!classement` - Voir le classement de la ligue du club inscrit',
          inline: false
        },
        {
          name: '🔔 Fonctionnement des notifications',
          value: 
            '• **Notifications automatiques :** Vous recevrez des alertes pour les matchs\n' +
            '• **Deadlines de composition :** Rappels 6h/3h/1h avant la deadline\n' +
            '• **Par salon :** Chaque salon Discord peut s\'inscrire à ses propres clubs\n' +
            '• **Plusieurs clubs :** Vous pouvez suivre plusieurs clubs par salon',
          inline: false
        },
        {
          name: '🎯 Comment trouver l\'ID d\'un club ?',
          value: 
            '• Utilisez `!club <nom>` pour rechercher par nom\n' +
            '• L\'ID apparaît dans l\'URL du club sur Soccerverse.com\n' +
            '• Exemple : soccerverse.com/clubs/2180 → ID = 2180',
          inline: false
        },
        {
          name: '🆘 Support',
          value: 
            '• Problème avec le bot ? Contactez les développeurs\n' +
            '• Suggestions d\'améliorations bienvenues !\n' +
            '• Version actuelle : **3.0.0**',
          inline: false
        }
      )
      .setFooter({ 
        text: 'Soccerverse Bot v3.0 • Bot non officiel', 
        iconURL: 'https://downloads.soccerverse.com/default_profile.jpg' 
      })
      .setTimestamp();

    // Ajouter les statistiques si demandé par un admin
    if (message.member && message.member.permissions.has('ADMINISTRATOR')) {
      const stats = dataManager.getStats();
      embed.addFields({
        name: '📊 Statistiques (Admin)',
        value: 
          `• **Salons actifs :** ${stats.totalChannels}\n` +
          `• **Clubs uniques :** ${stats.totalClubs}\n` +
          `• **Inscriptions totales :** ${stats.totalRegistrations}\n` +
          `• **Moyenne par salon :** ${stats.averageClubsPerChannel}`,
        inline: false
      });
    }

    await message.reply({ embeds: [embed] });
  }
};
