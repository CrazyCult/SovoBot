const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'calendrier',
  description: 'Afficher le calendrier d\'un club',
  usage: '!calendrier <club_id> [nombre_matchs]',
  
  async execute(message, args, { apiClient }) {
    // Vérifier qu'un ID de club est fourni
    if (args.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ ID manquant')
        .setDescription('Veuillez fournir l\'ID d\'un club.')
        .addFields({
          name: 'Utilisation',
          value: '`!calendrier <club_id> [nombre_matchs]`'
        })
        .addFields({
          name: 'Exemple',
          value: '`!calendrier 2180 10` - Affiche les 10 derniers matchs du club 2180'
        })
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const clubId = parseInt(args[0]);
    let limit = 5;
    
    if (args.length > 1) {
      limit = Math.min(parseInt(args[1]) || 5, 20); // Max 20 matchs
    }
    
    // Vérifier que l'ID est un nombre
    if (isNaN(clubId)) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ ID invalide')
        .setDescription('L\'ID du club doit être un nombre.')
        .addFields({
          name: 'Exemple valide',
          value: '`!calendrier 2180`'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    try {
      // Récupérer les infos du club pour le nom
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

      // 🔧 CORRECTION: Utiliser getCurrentSeason() au lieu de hardcoder
      let allMatches = [];
      let seasonId = await apiClient.getCurrentSeason();
      
      console.log(`🔍 Recherche calendrier club ${clubId} - Saison courante: ${seasonId}`);
      
      // Essayer la saison courante d'abord, puis les précédentes
      const seasonsToTry = [seasonId, seasonId - 1];
      
      for (const testSeason of seasonsToTry) {
        try {
          console.log(`🔍 Test saison ${testSeason} pour club ${clubId}`);
          
          const result = await apiClient.makeRpcRequest('get_club_schedule', {
            club_id: parseInt(clubId),
            season_id: testSeason
          });
          
          console.log(`📊 Réponse brute saison ${testSeason}:`, result ? 'données reçues' : 'vide');
          
          // Gérer les différents formats de réponse
          let matches = null;
          if (result && result.data && Array.isArray(result.data)) {
            matches = result.data;
          } else if (result && Array.isArray(result)) {
            matches = result;
          }
          
          if (matches && matches.length > 0) {
            allMatches = matches;
            seasonId = testSeason;
            console.log(`✅ Trouvé ${matches.length} matchs en saison ${testSeason}`);
            break;
          }
        } catch (error) {
          console.log(`⚠️ Erreur saison ${testSeason}:`, error.message);
          continue;
        }
      }
      
      if (allMatches.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('📅 Aucun match trouvé')
          .setDescription(`Aucun match trouvé pour **${clubData.display_name}** dans les saisons récentes.`)
          .addFields({
            name: '💡 Information',
            value: `Saison actuelle détectée: ${seasonId}`
          })
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await message.reply({ embeds: [embed] });
        return;
      }

      // Enrichir les matchs avec les noms
      const enrichedMatches = allMatches.map(match => ({
        ...match,
        home_club_name: apiClient.getClubName(match.home_club),
        away_club_name: apiClient.getClubName(match.away_club),
        stadium_name: apiClient.getStadiumName(match.stadium_id),
        competition_type: apiClient.getCompetitionType(match.comp_type)
      }));

      // Trier par date (plus récent en premier)
      enrichedMatches.sort((a, b) => b.date - a.date);

      // Limiter le nombre de matchs
      const matchesToShow = enrichedMatches.slice(0, limit);

      // Créer l'embed
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle(`📅 Calendrier - ${clubData.display_name}`)
        .setDescription(`**Saison ${seasonId}** - ${matchesToShow.length} derniers matchs`)
        .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`)
        .setURL(`https://play.soccerverse.com/club/${clubId}`)
        .setFooter({ text: `Club ID: ${clubId} • Soccerverse Bot v3.0` });

      // Ajouter chaque match
      for (const match of matchesToShow) {
        const isHome = match.home_club === clubId;
        const opponent = isHome ? match.away_club_name : match.home_club_name;
        const venue = isHome ? '🏟️' : '✈️';
        
        const matchDate = new Date(match.date * 1000);
        const dateStr = matchDate.toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
        
        let scoreStr = '';
        let statusEmoji = '';
        
        if (match.played === 1) {
          const clubGoals = isHome ? match.home_goals : match.away_goals;
          const opponentGoals = isHome ? match.away_goals : match.home_goals;
          scoreStr = `${clubGoals}-${opponentGoals}`;
          
          if (clubGoals > opponentGoals) {
            statusEmoji = '🟢';
          } else if (clubGoals < opponentGoals) {
            statusEmoji = '🔴';
          } else {
            statusEmoji = '🟡';
          }
        } else {
          scoreStr = 'À venir';
          statusEmoji = '⏳';
        }

        embed.addFields({
          name: `${statusEmoji} ${venue} ${opponent}`,
          value: `**${scoreStr}** • ${dateStr}\n${match.competition_type}`,
          inline: false
        });
      }

      await message.reply({ embeds: [embed] });

    } catch (error) {
      console.error('Erreur calendrier:', error);
      
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription('Impossible de récupérer le calendrier.')
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        })
        .setFooter({ text: 'Réessayez dans quelques instants' });
      
      await message.reply({ embeds: [embed] });
    }
  }
};
