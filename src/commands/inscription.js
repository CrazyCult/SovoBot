const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'inscription',
  description: 'S\'inscrire aux notifications d\'un club',
  usage: '!inscription <club_id>',
  
  async execute(message, args, { apiClient, dataManager }) {
    if (args.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ ID de club requis')
        .setDescription('**Usage:** `!inscription <club_id>`\n\n**Exemple:** `!inscription 2180`')
        .addFields({
          name: '💡 Comment trouver l\'ID d\'un club ?',
          value: 'Utilisez `!club <nom>` pour rechercher un club par nom.'
        })
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
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
          value: '`!inscription 2180`'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const channelId = message.channel.id;
    
    // Vérifier si déjà inscrit
    if (dataManager.isTeamRegistered(channelId, clubId)) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Déjà inscrit')
        .setDescription(`Le club **#${clubId}** est déjà enregistré dans ce salon.`)
        .addFields({
          name: '📋 Clubs inscrits',
          value: `Utilisez \`!club\` pour voir tous les clubs inscrits.`
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    try {
      // Vérifier que le club existe via l'API
      const clubData = await apiClient.getClubDetails(clubId);
      
      // Inscrire le club
      dataManager.registerTeam(channelId, clubId);
      await dataManager.save();
      
      // Créer l'embed de confirmation
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Inscription réussie !')
        .setDescription(`**${clubData.display_name}** est maintenant inscrit dans ce salon.`)
        .addFields(
          {
            name: '🏟️ Club',
            value: `${clubData.display_name} (#${clubData.club_id})`,
            inline: true
          },
          {
            name: '👤 Manager',
            value: clubData.manager_name || 'Inconnu',
            inline: true
          },
          {
            name: '🌍 Pays',
            value: clubData.country_id || 'Inconnu',
            inline: true
          },
          {
            name: '💰 Trésorerie',
            value: apiClient.formatMoney(clubData.balance),
            inline: true
          },
          {
            name: '📊 Forme',
            value: apiClient.formatForm(clubData.form),
            inline: true
          },
          {
            name: '👥 Fans',
            value: clubData.fans_current ? clubData.fans_current.toLocaleString() : 'Inconnu',
            inline: true
          }
        )
        .setFooter({ 
          text: `Vous recevrez les notifications des matchs dans ce salon • ${new Date().toLocaleDateString('fr-FR')}` 
        });

      // Ajouter une photo de profil si disponible
      if (clubData.profile_pic && clubData.profile_pic !== 'https://downloads.soccerverse.com/default_profile.jpg') {
        embed.setThumbnail(clubData.profile_pic);
      }

      await message.reply({ embeds: [embed] });
      
    } catch (error) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription(`Impossible de trouver le club avec l'ID **${clubId}**.`)
        .addFields({
          name: '💡 Suggestions',
          value: '• Vérifiez que l\'ID est correct\n• Utilisez `!club <nom>` pour rechercher par nom'
        });
      
      await message.reply({ embeds: [embed] });
    }
  }
};