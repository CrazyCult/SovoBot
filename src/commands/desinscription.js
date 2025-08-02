const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'desinscription',
  description: 'Se désinscrire des notifications d\'un club',
  usage: '!desinscription <club_id>',
  
  async execute(message, args, { apiClient, dataManager }) {
    const channelId = message.channel.id;
    const registeredClubs = dataManager.getChannelClubs(channelId);
    
    // Si pas de clubs inscrits
    if (registeredClubs.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Aucun club inscrit')
        .setDescription('Ce salon n\'a aucun club inscrit aux notifications.')
        .addFields({
          name: '💡 Pour s\'inscrire',
          value: 'Utilisez `!inscription <club_id>`'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    // Si aucun ID spécifié et qu'un seul club
    if (args.length === 0) {
      if (registeredClubs.length === 1) {
        const clubId = registeredClubs[0];
        
        try {
          const clubData = await apiClient.getClubDetails(clubId);
          
          // Désinscrire
          dataManager.unregisterTeam(channelId, clubId);
          await dataManager.save();
          
          const embed = new EmbedBuilder()
            .setColor('#4CAF50')
            .setTitle('✅ Désinscription réussie')
            .setDescription(`**${clubData.display_name}** a été retiré des notifications de ce salon.`)
            .setFooter({ text: `Club ID: ${clubId}` });
          
          await message.reply({ embeds: [embed] });
          return;
          
        } catch (error) {
          // Désinscrire même si l'API échoue
          dataManager.unregisterTeam(channelId, clubId);
          await dataManager.save();
          
          const embed = new EmbedBuilder()
            .setColor('#4CAF50')
            .setTitle('✅ Désinscription réussie')
            .setDescription(`Le club **#${clubId}** a été retiré des notifications.`);
          
          await message.reply({ embeds: [embed] });
          return;
        }
      }
      
      // Plusieurs clubs inscrits, demander de spécifier
      let clubsList = '';
      for (const clubId of registeredClubs) {
        try {
          const clubData = await apiClient.getClubDetails(clubId);
          clubsList += `• **${clubData.display_name}** (#${clubId})\n`;
        } catch (error) {
          clubsList += `• **Club #${clubId}** (nom inconnu)\n`;
        }
      }
      
      const embed = new EmbedBuilder()
        .setColor('#2196F3')
        .setTitle('📋 Clubs inscrits')
        .setDescription('Spécifiez l\'ID du club à désinscrire :')
        .addFields({
          name: 'Clubs actuellement inscrits',
          value: clubsList || 'Aucun'
        })
        .addFields({
          name: '💡 Usage',
          value: '`!desinscription <club_id>`'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const clubId = args[0];
    
    // Vérifier que l'ID est un nombre
    if (isNaN(clubId)) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ ID invalide')
        .setDescription('L\'ID du club doit être un nombre.')
        .addFields({
          name: 'Exemple valide',
          value: '`!desinscription 2180`'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    // Vérifier si le club est inscrit
    if (!dataManager.isTeamRegistered(channelId, clubId)) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Club non inscrit')
        .setDescription(`Le club **#${clubId}** n'est pas inscrit dans ce salon.`)
        .addFields({
          name: '📋 Voir les clubs inscrits',
          value: 'Utilisez `!club` pour voir tous les clubs inscrits.'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    try {
      // Essayer de récupérer les infos du club
      const clubData = await apiClient.getClubDetails(clubId);
      
      // Désinscrire
      dataManager.unregisterTeam(channelId, clubId);
      await dataManager.save();
      
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Désinscription réussie')
        .setDescription(`**${clubData.display_name}** a été retiré des notifications de ce salon.`)
        .addFields({
          name: '🏟️ Club désinscrit',
          value: `${clubData.display_name} (#${clubData.club_id})`,
        })
        .setFooter({ 
          text: `${new Date().toLocaleDateString('fr-FR')}` 
        });

      await message.reply({ embeds: [embed] });
      
    } catch (error) {
      // Désinscrire même si l'API échoue
      dataManager.unregisterTeam(channelId, clubId);
      await dataManager.save();
      
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Désinscription réussie')
        .setDescription(`Le club **#${clubId}** a été retiré des notifications de ce salon.`)
        .setFooter({ 
          text: 'Impossible de récupérer les détails du club, mais la désinscription a réussi.' 
        });
      
      await message.reply({ embeds: [embed] });
    }
  }
};