const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'stats-noms',
  description: 'Affiche les statistiques de la base de données des noms',
  usage: '!stats-noms',

  async execute(message, args, { apiClient }) {
    try {
      const stats = apiClient.mappingManager.getStats();

      // Calculer le temps depuis la dernière mise à jour
      let updateInfo = 'Inconnue';
      let nextUpdateInfo = 'Inconnue';

      if (stats.lastUpdate) {
        const now = new Date();
        const diffMs = now - stats.lastUpdate;
        const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
        const diffHours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

        updateInfo = stats.lastUpdate.toLocaleString('fr-FR', {
          dateStyle: 'full',
          timeStyle: 'short'
        });

        if (diffDays > 0) {
          updateInfo += ` (il y a ${diffDays} jour${diffDays > 1 ? 's' : ''})`;
        } else if (diffHours > 0) {
          updateInfo += ` (il y a ${diffHours} heure${diffHours > 1 ? 's' : ''})`;
        } else {
          updateInfo += ' (récent)';
        }

        if (stats.nextUpdate) {
          nextUpdateInfo = stats.nextUpdate.toLocaleString('fr-FR', {
            dateStyle: 'full',
            timeStyle: 'short'
          });
        }
      }

      const embed = new EmbedBuilder()
        .setColor('#5865f2')
        .setTitle('📊 Statistiques Base de Données')
        .setDescription('État de la base de données des noms de joueurs, clubs et compétitions')
        .addFields(
          {
            name: '👥 Joueurs',
            value: `**${stats.players.toLocaleString()}** joueurs`,
            inline: true
          },
          {
            name: '🏟️ Clubs',
            value: `**${stats.clubs.toLocaleString()}** clubs`,
            inline: true
          },
          {
            name: '🏆 Ligues',
            value: `**${stats.leagues.toLocaleString()}** ligues`,
            inline: true
          },
          {
            name: '🏟️ Stades',
            value: `**${stats.stadiums.toLocaleString()}** stades`,
            inline: true
          },
          {
            name: '🏆 Coupes',
            value: `**${stats.cups.toLocaleString()}** coupes`,
            inline: true
          },
          {
            name: '📅 Dernière mise à jour',
            value: updateInfo,
            inline: false
          },
          {
            name: '⏰ Prochaine mise à jour',
            value: nextUpdateInfo,
            inline: false
          },
          {
            name: '🔄 Mise à jour automatique',
            value: 'Tous les **dimanches à 3h00** (Europe/Paris)',
            inline: false
          },
          {
            name: '💡 Commandes',
            value: '• `!update-noms` - Forcer la mise à jour manuelle (admin)',
            inline: false
          }
        )
        .setFooter({ text: 'Soccerverse Bot v3.0 • Source: elrincondeldt.com' })
        .setTimestamp();

      await message.reply({ embeds: [embed] });

    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription('Impossible de récupérer les statistiques.')
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        })
        .setTimestamp();

      await message.reply({ embeds: [errorEmbed] });
    }
  }
};
