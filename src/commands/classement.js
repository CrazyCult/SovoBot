const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'classement',
  description: 'Afficher le classement de la ligue d\'un club',
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
            value: '`!classement` ou `!classement <club_id>`'
          });
        
        await message.reply({ embeds: [embed] });
        return;
      }

      clubId = parseInt(registeredClubs[0]);
    } else {
      clubId = parseInt(args[0]);
    }
    
    if (isNaN(clubId)) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ ID invalide')
        .setDescription('L\'ID du club doit être un nombre.');
      
      await message.reply({ embeds: [embed] });
      return;
    }

    try {
      const clubData = await apiClient.getClubDetails(clubId);
      const leagueTable = await apiClient.getLeagueTable(clubData.league_id);
      
      if (!leagueTable || leagueTable.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('⚠️ Classement indisponible');
        await message.reply({ embeds: [embed] });
        return;
      }

      const clubPosition = leagueTable.findIndex(team => team.club_id === clubId);
      const targetClub = leagueTable[clubPosition];
      
      if (clubPosition === -1) {
        const embed = new EmbedBuilder()
          .setColor('#FF6B6B')
          .setTitle('❌ Club non trouvé');
        await message.reply({ embeds: [embed] });
        return;
      }

      // Nom de la ligue
      const leagueName = apiClient.getLeagueNameByCountryDivision(clubData.country_id, clubData.division);
      const countryName = apiClient.formatCountryName(clubData.country_id);

      const embed = new EmbedBuilder()
        .setColor('#2196F3')
        .setTitle(`📊 Classement - ${leagueName}`)
        .setDescription(
          `🌍 ${countryName} • Division ${clubData.division}\n` +
          `**${apiClient.getClubName(clubId)}** est actuellement **${targetClub.new_position}ème** sur **${leagueTable.length} équipes**`
        )
        .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`);

      // Info du club cible
      const targetGoalDiff = targetClub.goals_for - targetClub.goals_against;
      const targetGoalDiffStr = targetGoalDiff >= 0 ? `+${targetGoalDiff}` : `${targetGoalDiff}`;
      const targetEvolution = this.getEvolutionEmoji(targetClub.old_position, targetClub.new_position);
      const targetForme = this.formatFormEmoji(targetClub.form);
      
      embed.addFields({
        name: `🏆 ${apiClient.getClubName(clubId)} (#${clubId})`,
        value: 
          `**Position:** ${targetClub.new_position}ème ${targetEvolution}\n` +
          `**Points:** ${targetClub.pts} • **Matchs:** ${targetClub.played}\n` +
          `**V-N-D:** ${targetClub.won}-${targetClub.drawn}-${targetClub.lost}\n` +
          `**Buts:** ${targetClub.goals_for}:${targetClub.goals_against} (${targetGoalDiffStr})\n` +
          `**Forme:** ${targetForme}`,
        inline: false
      });

      // Construire le classement complet
      const maxTeams = Math.min(leagueTable.length, 15);
      let tableLines = [];

      for (let i = 0; i < maxTeams; i++) {
        const team = leagueTable[i];
        const clubName = apiClient.getClubName(team.club_id);
        const isTarget = team.club_id === clubId;
        
        // Tronquer le nom si trop long
        let displayName = clubName.length > 20 ? clubName.substring(0, 17) + '...' : clubName;
        
        const goalDiff = team.goals_for - team.goals_against;
        const goalDiffStr = goalDiff >= 0 ? `+${goalDiff}` : `${goalDiff}`;
        const evolution = this.getEvolutionEmoji(team.old_position, team.new_position);
        
        // Format compact sur une ligne
        if (isTarget) {
          tableLines.push(`**► ${team.new_position}. ${displayName} ◄** - ${team.pts}pts (${team.won}-${team.drawn}-${team.lost}) ${evolution}`);
        } else {
          tableLines.push(`${team.new_position}. ${displayName} - ${team.pts}pts (${team.won}-${team.drawn}-${team.lost}) ${evolution}`);
        }
      }

      // Diviser en plusieurs fields si nécessaire (max 1024 caractères par field)
      const linesPerField = 10;
      const fieldLines = [];
      
      for (let i = 0; i < tableLines.length; i += linesPerField) {
        const chunk = tableLines.slice(i, i + linesPerField);
        fieldLines.push(chunk.join('\n'));
      }

      // Ajouter les fields
      fieldLines.forEach((content, index) => {
        const fieldName = index === 0 ? 
          `📋 Classement complet (${leagueTable.length} équipes)` : 
          `📋 Suite`;
        
        embed.addFields({
          name: fieldName,
          value: content,
          inline: false
        });
      });

      // Afficher plus d'équipes si le classement est long
      if (leagueTable.length > maxTeams) {
        embed.addFields({
          name: '📝 Note',
          value: `Affichage des ${maxTeams} premières équipes sur ${leagueTable.length} au total.`,
          inline: false
        });
      }

      embed.setFooter({ 
        text: `Ligue #${clubData.league_id} • Saison ${targetClub.season_id} • Soccerverse Bot v3.0` 
      })
      .setTimestamp();

      await message.reply({ embeds: [embed] });

    } catch (error) {
      console.error('❌ Erreur classement:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription('Erreur lors de la récupération du classement.')
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        });
      
      await message.reply({ embeds: [errorEmbed] });
    }
  },

  getEvolutionEmoji(oldPosition, newPosition) {
    if (!oldPosition || oldPosition === newPosition) {
      return '(=)';
    } else if (newPosition < oldPosition) {
      const diff = oldPosition - newPosition;
      return `(⬆️${diff})`;
    } else {
      const diff = newPosition - oldPosition;
      return `(⬇️${diff})`;
    }
  },

  formatFormEmoji(form) {
    if (!form) return '⚪⚪⚪⚪⚪⚪';
    
    // Prendre les 6 derniers résultats
    const last6 = form.slice(-6).split('').map(char => {
      switch (char) {
        case 'W': return '🟢';
        case 'D': return '🟡';
        case 'L': return '🔴';
        default: return '⚪';
      }
    }).join('');
    
    // Padding si moins de 6 matchs
    const padded = last6 + '⚪'.repeat(Math.max(0, 6 - last6.length));
    return padded.substring(0, 6);
  }
};
