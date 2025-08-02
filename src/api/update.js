const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'update',
  description: 'Mettre à jour les mappings de noms (admin seulement)',
  usage: '!update',
  
  async execute(message, args, { apiClient, dataManager }) {
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
      .setColor('#FFA500')
      .setTitle('🔄 Mise à jour en cours...')
      .setDescription('Téléchargement des nouveaux mappings depuis SVBase...')
      .addFields({
        name: '⏱️ Estimation',
        value: 'Cette opération peut prendre 1-2 minutes.',
        inline: false
      })
      .setFooter({ text: 'Veuillez patienter...' });

    const statusMessage = await message.reply({ embeds: [embed] });

    try {
      // Récupérer les stats avant mise à jour
      const statsBefore = apiClient.mappingManager.getStats();
      
      // Forcer la mise à jour
      await apiClient.mappingManager.forceUpdate();
      
      // Récupérer les stats après mise à jour
      const statsAfter = apiClient.mappingManager.getStats();
      
      // Créer l'embed de succès
      const successEmbed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Mise à jour réussie !')
        .setDescription('Le data pack Soccerverse a été mis à jour avec succès.')
        .addFields(
          {
            name: '📊 Statistiques',
            value: 
              `**Clubs :** ${statsBefore.clubs} → ${statsAfter.clubs}\n` +
              `**Joueurs :** ${statsBefore.players} → ${statsAfter.players}\n` +
              `**Ligues :** ${statsBefore.leagues} → ${statsAfter.leagues}\n` +
              `**Stades :** ${statsBefore.stadiums} → ${statsAfter.stadiums}\n` +
              `**Coupes :** ${statsBefore.cups} → ${statsAfter.cups}`,
            inline: true
          },
          {
            name: '📅 Dernière mise à jour',
            value: new Date().toLocaleString('fr-FR'),
            inline: true
          },
          {
            name: '🔄 Prochaine mise à jour automatique',
            value: statsAfter.nextUpdate ? statsAfter.nextUpdate.toLocaleDateString('fr-FR') : 'Dimanche prochain 3h00',
            inline: true
          }
        )
        .setFooter({ 
          text: 'Source: elrincondeldt.com/sv • Tous les noms sont maintenant à jour' 
        })
        .setTimestamp();

      await statusMessage.edit({ embeds: [successEmbed] });
      
    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur de mise à jour')
        .setDescription('Une erreur est survenue lors de la mise à jour des mappings.')
        .addFields({
          name: '🔧 Détails de l\'erreur',
          value: error.message || 'Erreur inconnue',
          inline: false
        })
        .addFields({
          name: '💡 Solution',
          value: 'Les mappings actuels restent disponibles. Réessayez dans quelques minutes.',
          inline: false
        })
        .setFooter({ text: 'Contactez un développeur si le problème persiste' });

      await statusMessage.edit({ embeds: [errorEmbed] });
    }
  }
};