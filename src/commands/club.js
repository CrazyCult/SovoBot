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
        const isRegistered = true; // Par définition, il est inscrit
        
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
            text: `${new Date().toLocaleDateString('fr-FR')}` 
          });

        // CORRECTION: Utiliser l'image spécifique du club avec backticks pour l'interpolation
        const clubImageUrl = `https://elrincondeldt.com/sv/photos/teams/${clubId}.png`;
        
        // Essayer d'abord l'image spécifique du club, sinon fallback sur profile_pic
        if (clubImageUrl) {
          embed.setThumbnail(clubImageUrl);
        } else if (clubData.profile_pic && clubData.profile_pic !== 'https://downloads.soccerverse.com/default_profile.jpg') {
          embed.setThumbnail(clubData.profile_pic);
        }

        embeds.push(embed);
        
      } catch (error) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF6B6B')
          .setTitle(`🏟️ Club #${clubId} (${i + 1}/${registeredClubs.length})`)
          .setDescription('⚠️ **Données indisponibles**')
          .addFields({
            name: 'Erreur',
            value: 'Impossible de récupérer les informations de ce club.'
          });
        
        embeds.push(errorEmbed);
      }
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
        .setDescription(isRegistered ? '✅ **Inscrit aux notifications**' : 'Non inscrit aux notifications')
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
            value: `**Connexion:** ${apiClient.formatTimestamp(clubData.manager_last_active_unix)}\n**Transferts entrants:** ${clubData.transfers_in}\n**Transferts sortants:** ${clubData.transfers_out}`,
            inline: true
          },
          {
            name: '📈 Forme récente',
            value: apiClient.formatForm(clubData.form),
            inline: true
          }
        )
        .setFooter({ 
          text: `${new Date().toLocaleDateString('fr-FR')}` 
        });

      // CORRECTION: Utiliser l'image spécifique du club avec backticks pour l'interpolation
      const clubImageUrl = `https://elrincondeldt.com/sv/photos/teams/${clubId}.png`;
      
      // Essayer d'abord l'image spécifique du club, sinon fallback sur profile_pic
      if (clubImageUrl) {
        embed.setThumbnail(clubImageUrl);
      } else if (clubData.profile_pic && clubData.profile_pic !== 'https://downloads.soccerverse.com/default_profile.jpg') {
        embed.setThumbnail(clubData.profile_pic);
      }

      // Ajouter des boutons d'action
      const actionRow = new ActionRowBuilder();
      
      if (isRegistered) {
        actionRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`unregister_${clubId}`)
            .setLabel('Se désinscrire')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔕')
        );
      } else {
        actionRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`register_${clubId}`)
            .setLabel('S\'inscrire aux notifications')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🔔')
        );
      }

      await message.reply({ 
        embeds: [embed], 
        components: [actionRow] 
      });
      
    } catch (error) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Club introuvable')
        .setDescription(`Impossible de trouver le club avec l'ID **${clubId}**.`)
        .addFields({
          name: '💡 Suggestions',
          value: '• Vérifiez que l\'ID est correct\n• Utilisez `!club <nom>` pour rechercher par nom'
        });
      
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
