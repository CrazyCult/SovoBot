const logger = require('../utils/logger');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'club',
  description: 'Afficher les infos d\'un club ou des clubs inscrits',
  usage: '!club [club_id|nom]',
  
  async execute(message, args, { apiClient, dataManager }) {
    const channelId = message.channel.id;
    
    // Si aucun argument, afficher les clubs inscrits dans ce salon
    if (args.length === 0) {
      return await this.showRegisteredClubs(message, { apiClient, dataManager });
    }

    const search = args.join(' ');
    
    // Si c'est un nombre, rechercher par ID
    if (!isNaN(search)) {
      return await this.showClubById(message, search, { apiClient, dataManager });
    }
    
    // Sinon, rechercher par nom
    return await this.searchClubByName(message, search, { apiClient, dataManager });
  },

  async showRegisteredClubs(message, { apiClient, dataManager }) {
    const channelId = message.channel.id;
    const registeredClubs = dataManager.getChannelClubs(channelId);
    
    if (registeredClubs.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('📋 Aucun club inscrit')
        .setDescription('Ce salon n\'a aucun club inscrit aux notifications.')
        .addFields({
          name: '💡 Pour s\'inscrire',
          value: '`!inscription <club_id>`'
        })
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    // Si un seul club, afficher les détails complets
    if (registeredClubs.length === 1) {
      return await this.showClubById(message, registeredClubs[0], { apiClient, dataManager });
    }

    // Plusieurs clubs : afficher tous les détails complets
    const embeds = [];
    
    for (let i = 0; i < registeredClubs.length; i++) {
      const clubId = registeredClubs[i];
      
      try {
        const clubData = await apiClient.getClubDetails(clubId);
        
        const embed = new EmbedBuilder()
          .setColor('#4CAF50')
          .setTitle(`🏟️ ${clubData.display_name} (${i + 1}/${registeredClubs.length})`)
          .setDescription('✅ **Inscrit aux notifications**')
          .addFields(
            {
              name: '🔗 Lien direct',
              value: `[Voir sur Soccerverse](https://play.soccerverse.com/club/${clubId})`,
              inline: false
            },
            {
              name: '📊 Infos générales',
              value: `**ID:** ${clubData.club_id}\n**Entraîneur:** ${clubData.manager_name}\n**Pays:** ${apiClient.formatCountryName(clubData.country_id)}\n**Division:** ${clubData.division + 1}`,
              inline: true
            },
            {
              name: '💰 Finances',
              value: `**Trésorerie:** ${apiClient.formatMoney(clubData.balance)}\n**Salaires:** ${apiClient.formatMoney(clubData.total_wages)}\n**Valeur équipe:** ${apiClient.formatMoney(clubData.total_player_value)}`,
              inline: true
            },
            {
              name: '⚽ Statistiques',
              value: `**Rating moyen:** ${clubData.avg_player_rating}\n**Top 21:** ${clubData.avg_player_rating_top21}`,
              inline: true
            },
            {
              name: '👥 Supporters',
              value: `**Fans:** ${clubData.fans_current?.toLocaleString() || 'Inconnu'}\n**Stade:** ${apiClient.getStadiumName(clubData.stadium_id)}\n**Capacité:** ${clubData.stadium_size_current?.toLocaleString() || 'Inconnu'}`,
              inline: true
            },
            {
              name: '📈 Forme récente',
              value: apiClient.formatForm(clubData.form),
              inline: false
            }
          )
          .setFooter({ 
            text: `Club ID: ${clubId} • ${new Date().toLocaleDateString('fr-FR')}` 
          });

        // Image du club
        const clubImageUrl = `https://elrincondeldt.com/sv/photos/teams/${clubId}.png`;
        embed.setThumbnail(clubImageUrl);

        embeds.push(embed);
        
      } catch (error) {
        // ✅ CORRECTION: Afficher un embed d'erreur propre au lieu de crash
        logger.error(`Erreur récupération club ${clubId}:`, error);
        
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF6B6B')
          .setTitle(`🏟️ Club #${clubId} (${i + 1}/${registeredClubs.length})`)
          .setDescription('⚠️ **Données indisponibles**')
          .addFields({
            name: 'Erreur',
            value: `Impossible de récupérer les informations de ce club.\n\`\`\`${error.message}\`\`\``
          })
          .addFields({
            name: '💡 Actions',
            value: '• Vérifiez que le club existe toujours\n• Réessayez dans quelques instants\n• Utilisez `!desinscription ${clubId}` pour le retirer'
          });
        
        embeds.push(errorEmbed);
      }
    }

    // ✅ CORRECTION: Vérifier qu'on a des embeds avant d'envoyer
    if (embeds.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription('Impossible de récupérer les informations des clubs inscrits.')
        .addFields({
          name: '💡 Solution',
          value: 'Essayez de désinscrire et réinscrire vos clubs.'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    // Envoyer tous les embeds (Discord limite à 10 embeds par message)
    const maxEmbedsPerMessage = 10;
    for (let i = 0; i < embeds.length; i += maxEmbedsPerMessage) {
      const chunk = embeds.slice(i, i + maxEmbedsPerMessage);
      await message.reply({ embeds: chunk });
    }
  },

  async showClubById(message, clubId, { apiClient, dataManager }) {
    try {
      const clubData = await apiClient.getClubDetails(clubId);
      const channelId = message.channel.id;
      const isRegistered = dataManager.isTeamRegistered(channelId, clubId);
      
      const embed = new EmbedBuilder()
        .setColor(isRegistered ? '#4CAF50' : '#2196F3')
        .setTitle(`🏟️ ${clubData.display_name}`)
        .setDescription(isRegistered ? '✅ **Inscrit aux notifications**' : 'ℹ️ Informations du club')
        .addFields(
          {
            name: '🔗 Lien direct',
            value: `[Voir sur Soccerverse](https://play.soccerverse.com/club/${clubId})`,
            inline: false
          },
          {
            name: '📊 Infos générales',
            value: `**ID:** ${clubData.club_id}\n**Entraîneur:** ${clubData.manager_name}\n**Pays:** ${apiClient.formatCountryName(clubData.country_id)}\n**Division:** ${clubData.division + 1}`,
            inline: true
          },
          {
            name: '💰 Finances',
            value: `**Trésorerie:** ${apiClient.formatMoney(clubData.balance)}\n**Salaires totaux:** ${apiClient.formatMoney(clubData.total_wages)}\n**Salaire moyen:** ${apiClient.formatMoney(clubData.avg_wages)}\n**Valeur équipe:** ${apiClient.formatMoney(clubData.total_player_value)}`,
            inline: true
          },
          {
            name: '⚽ Statistiques',
            value: `**Rating moyen:** ${clubData.avg_player_rating}\n**Top 21:** ${clubData.avg_player_rating_top21}\n**Tir:** ${clubData.avg_shooting}\n**Passe:** ${clubData.avg_passing}\n**Tacle:** ${clubData.avg_tackling}\n**Gardien:** ${clubData.gk_rating}`,
            inline: true
          },
          {
            name: '👥 Supporters & Infrastructure',
            value: `**Supporters:** ${clubData.fans_current?.toLocaleString() || 'Inconnu'} ${apiClient.formatFansChange(clubData.fans_current, clubData.fans_start)}\n**Stade:** ${apiClient.getStadiumName(clubData.stadium_id)}\n**Capacité:** ${clubData.stadium_size_current?.toLocaleString() || 'Inconnu'} ${apiClient.formatCapacityChange(clubData.stadium_size_current, clubData.stadium_size_start)}`,
            inline: true
          },
          {
            name: '🏆 Compétition',
            value: `**Ligue:** ${apiClient.getLeagueNameByCountryDivision(clubData.country_id, clubData.division)} (#${clubData.league_id})\n**Catégorie:** Division ${clubData.division + 1}`,
            inline: true
          },
          {
            name: '📅 Activité',
            value: `**Dernière connexion:** ${apiClient.formatTimestamp(clubData.manager_last_active_unix)}\n**Transferts entrants:** ${clubData.transfers_in}\n**Transferts sortants:** ${clubData.transfers_out}`,
            inline: true
          },
          {
            name: '📈 Forme récente',
            value: apiClient.formatForm(clubData.form),
            inline: false
          }
        )
        .setFooter({ 
          text: `Club ID: ${clubId} • ${new Date().toLocaleDateString('fr-FR')}` 
        });

      // Image du club
      const clubImageUrl = `https://elrincondeldt.com/sv/photos/teams/${clubId}.png`;
      embed.setThumbnail(clubImageUrl);

      // Boutons d'action
      const row = new ActionRowBuilder();
      
      if (isRegistered) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`unregister_${clubId}`)
            .setLabel('Se désinscrire')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔕')
        );
      } else {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`register_${clubId}`)
            .setLabel('S\'inscrire')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🔔')
        );
      }
      
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`effectif_${clubId}`)
          .setLabel('Effectif')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('👥'),
        new ButtonBuilder()
          .setCustomId(`salaires_${clubId}`)
          .setLabel('Salaires')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('💰'),
        new ButtonBuilder()
          .setLabel('Soccerverse')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://play.soccerverse.com/club/${clubId}`)
          .setEmoji('🌐')
      );

      await message.reply({ embeds: [embed], components: [row] });
      
    } catch (error) {
      // ✅ CORRECTION: Meilleure gestion d'erreur avec plus de détails
      logger.error(`Erreur showClubById pour club ${clubId}:`, error);
      
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Club introuvable')
        .setDescription(`Impossible de récupérer les informations du club **#${clubId}**.`)
        .addFields({
          name: '🔍 Détails de l\'erreur',
          value: `\`\`\`${error.message}\`\`\``,
          inline: false
        })
        .addFields({
          name: '💡 Suggestions',
          value: '• Vérifiez que l\'ID est correct\n• Le club existe peut-être plus\n• L\'API est peut-être temporairement indisponible\n• Utilisez `!club <nom>` pour rechercher par nom',
          inline: false
        })
        .setFooter({ text: 'Réessayez dans quelques instants' });
      
      await message.reply({ embeds: [embed] });
    }
  },

  async searchClubByName(message, searchTerm, { apiClient, dataManager }) {
    try {
      const results = await apiClient.searchClubs(searchTerm, 10);
      
      if (results.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('🔍 Aucun résultat')
          .setDescription(`Aucun club trouvé pour la recherche : **${searchTerm}**`)
          .addFields({
            name: '💡 Conseils',
            value: '• Vérifiez l\'orthographe\n• Essayez avec moins de mots\n• Utilisez l\'ID du club si vous le connaissez'
          });
        
        await message.reply({ embeds: [embed] });
        return;
      }

      // Si un seul résultat, afficher les détails
      if (results.length === 1) {
        return await this.showClubById(message, results[0].club_id, { apiClient, dataManager });
      }

      // Plusieurs résultats, afficher la liste
      const embed = new EmbedBuilder()
        .setColor('#2196F3')
        .setTitle(`🔍 Résultats de recherche (${results.length})`)
        .setDescription(`Clubs trouvés pour : **${searchTerm}**`)
        .setFooter({ 
          text: 'Utilisez !club <id> pour voir les détails d\'un club spécifique' 
        });

      let resultsList = '';
      for (const club of results.slice(0, 10)) {
        const channelId = message.channel.id;
        const isRegistered = dataManager.isTeamRegistered(channelId, club.club_id);
        const status = isRegistered ? '✅' : '⭕';
        
        resultsList += `${status} **${club.display_name}**\n`;
        resultsList += `   └ ID: ${club.club_id} • Manager: ${club.manager_name}\n`;
        resultsList += `   └ ${apiClient.formatMoney(club.balance)} • ${apiClient.formatForm(club.form)}\n`;
        resultsList += `   └ [Voir sur Soccerverse](https://play.soccerverse.com/club/${club.club_id})\n\n`;
      }

      embed.addFields({
        name: 'Clubs trouvés',
        value: resultsList || 'Aucun résultat'
      });

      await message.reply({ embeds: [embed] });
      
    } catch (error) {
      logger.error('Erreur searchClubByName:', error);
      
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur de recherche')
        .setDescription('Une erreur est survenue lors de la recherche.')
        .addFields({
          name: 'Alternative',
          value: 'Essayez avec l\'ID du club : `!club <id>`'
        });
      
      await message.reply({ embeds: [embed] });
    }
  }
};

// Slash command definition
module.exports.slashCommand = new (require('discord.js').SlashCommandBuilder)()
  .setName('club')
  .setDescription('Afficher les infos d\'un club')
  .addStringOption(opt => opt
    .setName('recherche')
    .setDescription('ID ou nom du club (vide = clubs inscrits)')
    .setRequired(false)
  );
