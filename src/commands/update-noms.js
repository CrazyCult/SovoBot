const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'update-noms',
  description: 'Force la mise à jour de la base de données des noms de joueurs et clubs depuis l\'API',
  usage: '!update-noms',
  adminOnly: true,

  async execute(message, args, { apiClient }) {
    try {
      // Afficher un message de chargement
      const loadingEmbed = new EmbedBuilder()
        .setColor('#5865f2')
        .setTitle('⏳ Mise à jour en cours...')
        .setDescription('Téléchargement de la base de données depuis https://elrincondeldt.com/sv/rincon_v1.json')
        .setFooter({ text: 'Cela peut prendre quelques secondes...' })
        .setTimestamp();

      const loadingMsg = await message.reply({ embeds: [loadingEmbed] });

      // Récupérer les stats avant mise à jour
      const statsBefore = apiClient.mappingManager.getStats();

      // Forcer la mise à jour
      await apiClient.mappingManager.forceUpdate();

      // Récupérer les stats après mise à jour
      const statsAfter = apiClient.mappingManager.getStats();

      // Calculer les différences
      const clubsDiff = statsAfter.clubs - statsBefore.clubs;
      const playersDiff = statsAfter.players - statsBefore.players;
      const leaguesDiff = statsAfter.leagues - statsBefore.leagues;
      const stadiumsDiff = statsAfter.stadiums - statsBefore.stadiums;
      const cupsDiff = statsAfter.cups - statsBefore.cups;

      // Créer l'embed de succès
      const successEmbed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Mise à jour réussie !')
        .setDescription('La base de données des noms a été mise à jour avec succès.')
        .addFields(
          {
            name: '📊 Statistiques',
            value:
              `**Clubs:** ${statsAfter.clubs} (${clubsDiff >= 0 ? '+' : ''}${clubsDiff})\n` +
              `**Joueurs:** ${statsAfter.players} (${playersDiff >= 0 ? '+' : ''}${playersDiff})\n` +
              `**Ligues:** ${statsAfter.leagues} (${leaguesDiff >= 0 ? '+' : ''}${leaguesDiff})\n` +
              `**Stades:** ${statsAfter.stadiums} (${stadiumsDiff >= 0 ? '+' : ''}${stadiumsDiff})\n` +
              `**Coupes:** ${statsAfter.cups} (${cupsDiff >= 0 ? '+' : ''}${cupsDiff})`,
            inline: true
          },
          {
            name: '🕒 Dernière mise à jour',
            value: statsAfter.lastUpdate ?
              statsAfter.lastUpdate.toLocaleString('fr-FR', {
                dateStyle: 'full',
                timeStyle: 'short'
              }) : 'Inconnue',
            inline: true
          }
        )
        .setFooter({ text: 'Prochaine mise à jour automatique: dimanche 3h00 • Soccerverse Bot v3.0' })
        .setTimestamp();

      await loadingMsg.edit({ embeds: [successEmbed] });

    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur de mise à jour')
        .setDescription('Impossible de mettre à jour la base de données.')
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        })
        .setFooter({ text: 'Vérifiez les logs pour plus de détails' })
        .setTimestamp();

      await message.reply({ embeds: [errorEmbed] });
    }
  }
};
