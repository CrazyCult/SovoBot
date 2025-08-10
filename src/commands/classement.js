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
      console.log(`🔍 Récupération classement pour ligue ${clubData.league_id}...`);
      const leagueTable = await apiClient.getLeagueTable(clubData.league_id);
      console.log(`📊 Classement récupéré: ${leagueTable.length} équipes`);
      
      if (!leagueTable || leagueTable.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('⚠️ Classement indisponible')
          .setDescription(`Aucun classement disponible pour la ligue de ${clubData.display_name}.`)
          .setFooter({ text: 'Soccerverse Bot v3.0' });

        await message.reply({ embeds: [embed] });
        return;
      }

      // Avertir si le classement semble incomplet
      if (leagueTable.length < 16) {
        console.log(`⚠️ Classement possiblement incomplet: seulement ${leagueTable.length} équipes`);
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
        .setDescription(`**${clubData.display_name}** est actuellement **${targetClub.new_position}${this.getPositionSuffix(targetClub.new_position)}** sur ${leagueTable.length} équipes${leagueTable.length < 16 ? ' ⚠️ (classement possiblement incomplet)' : ''}`);

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

      // Afficher le classement en 2 colonnes pour optimiser l'espace
      const totalTeams = leagueTable.length;
      const teamsPerColumn = 10; // 10 équipes par colonne
      const maxTeamsToShow = 40; // Maximum 40 équipes (4 colonnes de 10)

      // Limiter le nombre d'équipes si nécessaire
      const teamsToShow = Math.min(totalTeams, maxTeamsToShow);
      const numColumns = Math.ceil(teamsToShow / teamsPerColumn);

      // Créer les colonnes par paires
      for (let pairIndex = 0; pairIndex < Math.ceil(numColumns / 2); pairIndex++) {
        const leftColumnIndex = pairIndex * 2;
        const rightColumnIndex = leftColumnIndex + 1;

        // Colonne de gauche
        const leftStart = leftColumnIndex * teamsPerColumn;
        const leftEnd = Math.min(leftStart + teamsPerColumn, teamsToShow);
        let leftColumnText = '';

        for (let i = leftStart; i < leftEnd; i++) {
          const team = leagueTable[i];
          const clubName = apiClient.getClubName(team.club_id);
          const isTarget = team.club_id === clubId;
          const positionChange = this.getPositionChange(team.old_position, team.new_position);

          // Mettre en évidence le club recherché
          const prefix = isTarget ? '**►** ' : '';
          const suffix = isTarget ? ' **◄**' : '';

          leftColumnText += `${prefix}**${team.new_position}.** ${clubName}${suffix}\n`;
          leftColumnText += `   └ ${team.pts}pts • ${team.won}-${team.drawn}-${team.lost} ${positionChange}\n\n`;
        }

        // Colonne de droite (si elle existe)
        let rightColumnText = '';
        if (rightColumnIndex < numColumns) {
          const rightStart = rightColumnIndex * teamsPerColumn;
          const rightEnd = Math.min(rightStart + teamsPerColumn, teamsToShow);

          for (let i = rightStart; i < rightEnd; i++) {
            const team = leagueTable[i];
            const clubName = apiClient.getClubName(team.club_id);
            const isTarget = team.club_id === clubId;
            const positionChange = this.getPositionChange(team.old_position, team.new_position);

            // Mettre en évidence le club recherché
            const prefix = isTarget ? '**►** ' : '';
            const suffix = isTarget ? ' **◄**' : '';

            rightColumnText += `${prefix}**${team.new_position}.** ${clubName}${suffix}\n`;
            rightColumnText += `   └ ${team.pts}pts • ${team.won}-${team.drawn}-${team.lost} ${positionChange}\n\n`;
          }
        }

        // Ajouter les champs (colonnes)
        const leftRange = `${leftStart + 1}-${leftEnd}`;
        embed.addFields({
          name: `📊 Classement ${leftRange}`,
          value: leftColumnText || 'Aucune donnée',
          inline: true
        });

        if (rightColumnText) {
          const rightRange = `${rightColumnIndex * teamsPerColumn + 1}-${rightColumnIndex * teamsPerColumn + Math.min(teamsPerColumn, teamsToShow - rightColumnIndex * teamsPerColumn)}`;
          embed.addFields({
            name: `📊 Classement ${rightRange}`,
            value: rightColumnText,
            inline: true
          });
        }

        // Ajouter un champ vide pour forcer un retour à la ligne
        embed.addFields({
          name: '\u200B', // Caractère invisible
          value: '\u200B',
          inline: true
        });
      }

      // Ajouter une note si le classement est tronqué
      if (totalTeams > maxTeamsToShow) {
        embed.addFields({
          name: '📝 Note',
          value: `Affichage des ${maxTeamsToShow} premières équipes sur ${totalTeams} au total.`,
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
