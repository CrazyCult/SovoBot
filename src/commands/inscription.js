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
      const clubData = await apiClient.getClubDetails(clubId);
      
      // Inscrire le club avec l'ID de l'utilisateur
      dataManager.registerTeam(channelId, clubId, message.author.id);
      await dataManager.save();
      
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Inscription réussie !')
        .setDescription(`**${clubData.display_name}** est maintenant inscrit dans ce salon par <@${message.author.id}>.`)
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
          },
          {
            name: '🔔 Notifications',
            value: 'Vous recevrez des mentions (@vous) pour:\n• Rappels de composition (6h/3h/1h avant)\n• Résultats de matchs\n• Enchères du club\n• Actualités du club (blessures, transferts, suspensions...)',
            inline: false
          }
        )
        .setFooter({ 
          text: `Inscrit par ${message.author.username} • ${new Date().toLocaleDateString('fr-FR')}` 
        });

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

module.exports.slashCommand = new (require('discord.js').SlashCommandBuilder)()
  .setName('inscription')
  .setDescription('S\'inscrire pour suivre un club')
  .addStringOption(opt => opt
    .setName('club')
    .setDescription('ID ou nom du club')
    .setRequired(true)
  );
