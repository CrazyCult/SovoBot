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

      // Nom de la ligue et division
      const leagueName = apiClient.getLeagueNameByCountryDivision(clubData.country_id, clubData.division);
      const divisionText = `Division: ${clubData.division}`;

      const embed = new EmbedBuilder()
        .setColor('#2196F3')
        .setTitle(`⚽ ${leagueName}`)
        .setDescription(`🌍 ${apiClient.formatCountryName(clubData.country_id)} • ${divisionText}`)
        .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`);

      // Construire le tableau ligne par ligne avec un format plus lisible
      const maxTeams = Math.min(leagueTable.length, 20);
      let tableLines = [];

      for (let i = 0; i < maxTeams; i++) {
        const team = leagueTable[i];
        const clubName = team.club_name; // ✅ Utilise le nom déjà enrichi par getLeagueTable
        const isTarget = team.club_id === clubId;
        
        // Tronquer le nom si trop long (max 20 caractères pour format compact)
        let displayName = clubName.length > 20 ? clubName.substring(0, 17) + '...' : clubName;

        const goalDiff = team.goals_for - team.goals_against;
        const goalDiffStr = goalDiff >= 0 ? `+${goalDiff}` : `${goalDiff}`;
        const forme = this.formatFormEmoji(team.form);

        // Format compact sur une seule ligne
        const positionText = isTarget ? `**${team.new_position}.**` : `${team.new_position}.`;
        const nameText = isTarget ? `**${displayName}**` : displayName;
        const statsText = `${team.pts}pts • ${team.won}-${team.drawn}-${team.lost} • ${team.goals_for}:${team.goals_against} (${goalDiffStr})`;

        const line = `${positionText} ${nameText} • ${statsText} ${forme}`;

        tableLines.push(line);
      }

      // Format compact permet d'afficher plus d'équipes par field
      const linesPerField = 10;
      const numFields = Math.ceil(tableLines.length / linesPerField);

      for (let fieldIndex = 0; fieldIndex < numFields; fieldIndex++) {
        const startIndex = fieldIndex * linesPerField;
        const endIndex = Math.min(startIndex + linesPerField, tableLines.length);
        const fieldLines = tableLines.slice(startIndex, endIndex);

        const fieldName = numFields === 1 ?
          `📊 Classement (${maxTeams} équipes)` :
          `📊 Classement (${startIndex + 1}-${endIndex})`;

        embed.addFields({
          name: fieldName,
          value: fieldLines.join('\n'),
          inline: false
        });
      }

      embed.setFooter({ 
        text: `Ligue #${clubData.league_id} • Saison ${targetClub.season_id} • Soccerverse Bot` 
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
    return last6.padEnd(6, '⚪').substring(0, 6).split('').join('');
  }
};
