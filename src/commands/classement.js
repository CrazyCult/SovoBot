const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'classement',
  description: 'Afficher le classement de la ligue d\'un club (inscrit ou spécifié)',
  usage: '!classement [club_id]',
  
  async execute(message, args, { apiClient, dataManager }) {
    const channelId = message.channel.id;
    let clubId;

    // Si aucun argument, utiliser les clubs enregistrés
    if (args.length === 0) {
      const registeredClubs = dataManager.getChannelClubs(channelId);
      
      if (registeredClubs.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('📋 Aucun club inscrit')
          .setDescription('Ce salon n\'a aucun club inscrit aux notifications.')
          .addFields({
            name: '💡 Usage',
            value: '• `!classement` - Classement du club inscrit\n• `!classement <club_id>` - Classement d\'un club spécifique'
          })
          .addFields({
            name: '📝 Pour s\'inscrire',
            value: '`!inscription <club_id>`'
          })
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await message.reply({ embeds: [embed] });
        return;
      }

      // Si plusieurs clubs inscrits, prendre le premier
      clubId = parseInt(registeredClubs[0]);
      
      // Si plus d'un club inscrit, afficher un message informatif
      if (registeredClubs.length > 1) {
        const clubNames = [];
        for (const id of registeredClubs.slice(0, 3)) {
          clubNames.push(apiClient.getClubName(parseInt(id)));
        }
        
        const embed = new EmbedBuilder()
          .setColor('#2196F3')
          .setTitle('📋 Plusieurs clubs inscrits')
          .setDescription(`Affichage du classement de **${apiClient.getClubName(clubId)}** (premier club inscrit).`)
          .addFields({
            name: '🏟️ Clubs inscrits dans ce salon',
            value: clubNames.join(', ') + (registeredClubs.length > 3 ? `... et ${registeredClubs.length - 3} autre(s)` : '')
          })
          .addFields({
            name: '💡 Astuce',
            value: 'Utilisez `!classement <club_id>` pour un club spécifique'
          })
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await message.reply({ embeds: [embed] });
      }
    } else {
      // Arguments fournis
      clubId = parseInt(args[0]);
    }
    
    // Vérifier que l'ID est un nombre
    if (isNaN(clubId)) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ ID invalide')
        .setDescription('L\'ID du club doit être un nombre.')
        .addFields({
          name: 'Exemple valide',
          value: '`!classement 2180`'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    try {
      // Récupérer les infos du club pour obtenir la ligue
      let clubData;
      try {
        clubData = await apiClient.getClubDetails(clubId);
      } catch (error) {
        const embed = new EmbedBuilder()
          .setColor('#FF6B6B')
          .setTitle('❌ Club introuvable')
          .setDescription(`Le club avec l'ID **${clubId}** n'existe pas.`)
          .addFields({
            name: '💡 Suggestion',
            value: 'Vérifiez l\'ID du club et réessayez.'
          });
        
        await message.reply({ embeds: [embed] });
        return;
      }
      
      // Récupérer le classement de la ligue
      const leagueTable = await apiClient.getLeagueTable(clubData.league_id);
      
      if (!leagueTable || leagueTable.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('⚠️ Classement indisponible')
          .setDescription(`Aucun classement disponible pour la ligue de ${clubData.display_name}.`)
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await message.reply({ embeds: [embed] });
        return;
      }

      // Trouver la position du club dans le classement
      const clubPosition = leagueTable.findIndex(team => team.club_id === clubId);
      const targetClub = leagueTable[clubPosition];
      
      if (clubPosition === -1) {
        const embed = new EmbedBuilder()
          .setColor('#FF6B6B')
          .setTitle('❌ Club non trouvé dans le classement')
          .setDescription(`Le club ${clubData.display_name} n'a pas été trouvé dans le classement de sa ligue.`)
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await message.reply({ embeds: [embed] });
        return;
      }

      // Créer l'embed principal
      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(`🏆 Classement - ${apiClient.getLeagueNameByCountryDivision(clubData.country_id, clubData.division)}`)
        .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`)
        .setDescription(`**${clubData.display_name}** est actuellement **${targetClub.new_position}${this.getPositionSuffix(targetClub.new_position)}** sur ${leagueTable.length} équipes`);

      // Statistiques du club sélectionné
      embed.addFields({
        name: `🎯 ${clubData.display_name} (#${clubId})`,
        value: `**Position:** ${targetClub.new_position}${this.getPositionSuffix(targetClub.new_position)} ${this.getPositionChange(targetClub.old_position, targetClub.new_position)}\n` +
               `**Points:** ${targetClub.pts} • **Matchs:** ${targetClub.played}\n` +
               `**V-N-D:** ${targetClub.won}-${targetClub.drawn}-${targetClub.lost}\n` +
               `**Buts:** ${targetClub.goals_for}:${targetClub.goals_against} (${targetClub.goals_for - targetClub.goals_against > 0 ? '+' : ''}${targetClub.goals_for - targetClub.goals_against})\n` +
               `**Forme:** ${apiClient.formatForm(targetClub.form)}`,
        inline: false
      });

      // Afficher TOUT le classement avec pagination si nécessaire
      const maxPerField = 10; // 10 équipes par field pour éviter les limites Discord
      const totalTeams = leagueTable.length;
      
      // Calculer le nombre de champs nécessaires
      const numFields = Math.ceil(totalTeams / maxPerField);
      
      for (let fieldIndex = 0; fieldIndex < numFields; fieldIndex++) {
        const startIndex = fieldIndex * maxPerField;
        const endIndex = Math.min(startIndex + maxPerField, totalTeams);
        
        let tableText = '';
        
        for (let i = startIndex; i < endIndex; i++) {
          const team = leagueTable[i];
          const clubName = apiClient.getClubName(team.club_id);
          const isTarget = team.club_id === clubId;
          const positionChange = this.getPositionChange(team.old_position, team.new_position);
          
          // Mettre en évidence le club recherché
          const prefix = isTarget ? '**►** ' : '';
          const suffix = isTarget ? ' **◄**' : '';
          
          tableText += `${prefix}**${team.new_position}.** ${clubName}${suffix}\n`;
          tableText += `   └ ${team.pts}pts • ${team.won}-${team.drawn}-${team.lost} • ${team.goals_for}:${team.goals_against} ${positionChange}\n\n`;
        }
        
        // Nom du champ selon la position
        let fieldName;
        if (numFields === 1) {
          fieldName = `📊 Classement complet (${totalTeams} équipes)`;
        } else {
          const rangeStart = startIndex + 1;
          const rangeEnd = endIndex;
          fieldName = `📊 Classement ${rangeStart}-${rangeEnd} (${totalTeams} équipes)`;
        }
        
        embed.addFields({
          name: fieldName,
          value: tableText || 'Aucune donnée',
          inline: false
        });
      }

      // Statistiques de la ligue
      const totalGoals = leagueTable.reduce((sum, team) => sum + team.goals_for, 0);
      const totalMatches = leagueTable.reduce((sum, team) => sum + team.played, 0);
      const leader = leagueTable[0];
      const lastPlace = leagueTable[leagueTable.length - 1];

      embed.addFields({
        name: '📈 Statistiques de la ligue',
        value: `**Équipes:** ${leagueTable.length}\n` +
               `**Matchs joués:** ${totalMatches}\n` +
               `**Buts marqués:** ${totalGoals}\n` +
               `**Leader:** ${apiClient.getClubName(leader.club_id)} (${leader.pts}pts)\n` +
               `**Dernier:** ${apiClient.getClubName(lastPlace.club_id)} (${lastPlace.pts}pts)`,
        inline: true
      });

      embed.setFooter({ 
        text: `Ligue ID: ${clubData.league_id} • Saison ${targetClub.season_id} • Soccerverse Bot v3.0` 
      })
      .setTimestamp();

      await message.reply({ embeds: [embed] });

    } catch (error) {
      console.error('❌ Erreur dans la commande classement:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription('Une erreur est survenue lors de la récupération du classement.')
        .addFields({
          name: '💡 Suggestions',
          value: '• Vérifiez que l\'ID du club est correct\n• Réessayez dans quelques instants'
        })
        .addFields({
          name: '🔧 Détails techniques',
          value: `\`\`\`${error.message}\`\`\``
        })
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [errorEmbed] });
    }
  },

  // Méthode helper pour obtenir le suffixe de position (1er, 2ème, etc.)
  getPositionSuffix(position) {
    if (position === 1) return 'er';
    return 'ème';
  },

  // Méthode helper pour obtenir l'évolution de position
  getPositionChange(oldPos, newPos) {
    if (oldPos === null || newPos === null) return '';
    
    const diff = oldPos - newPos;
    if (diff > 0) {
      return `📈(+${diff})`;
    } else if (diff < 0) {
      return `📉(${diff})`;
    } else {
      return '➡️(=)';
    }
  }
};
