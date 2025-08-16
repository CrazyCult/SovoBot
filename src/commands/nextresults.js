const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'nextresults',
  description: 'Afficher les prochains matchs qui auront leur résultat notifié (admin)',
  usage: '!nextresults',
  
  async execute(message, args, { apiClient, dataManager, matchResultWatcher }) {
    // Vérifier les permissions d'administrateur
    if (!message.member || !message.member.permissions.has('ADMINISTRATOR')) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Permission refusée')
        .setDescription('Cette commande est réservée aux administrateurs du serveur.')
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    if (!matchResultWatcher) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Service indisponible')
        .setDescription('Le service de notifications de résultats n\'est pas initialisé.')
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('🔄 Récupération des prochains matchs...')
      .setDescription('Analyse en cours des clubs inscrits...')
      .setFooter({ text: 'Cette opération peut prendre quelques secondes' });

    const statusMessage = await message.reply({ embeds: [embed] });

    try {
      const registeredClubs = dataManager.getAllRegisteredClubs();
      const upcomingMatches = [];
      
      if (registeredClubs.length === 0) {
        const noClubsEmbed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('📋 Aucun club inscrit')
          .setDescription('Aucun club n\'est inscrit aux notifications.')
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await statusMessage.edit({ embeds: [noClubsEmbed] });
        return;
      }

      // Récupérer les prochains matchs de tous les clubs inscrits
      for (const clubId of registeredClubs) {
        try {
          const nextMatch = await apiClient.getClubNextMatch(parseInt(clubId));
          
          if (nextMatch) {
            const matchTime = new Date(nextMatch.date * 1000);
            const now = new Date();
            const resultTime = new Date(matchTime.getTime() + (1 * 60 * 1000)); // +1 minute
            
            // Seulement les matchs dans les prochaines 7 jours
            const timeDiff = matchTime.getTime() - now.getTime();
            if (timeDiff > 0 && timeDiff <= 7 * 24 * 60 * 60 * 1000) {
              upcomingMatches.push({
                clubId: parseInt(clubId),
                clubName: apiClient.getClubName(parseInt(clubId)),
                matchTime: matchTime,
                resultTime: resultTime,
                homeClub: apiClient.getClubName(nextMatch.home_club),
                awayClub: apiClient.getClubName(nextMatch.away_club),
                isHome: nextMatch.home_club == clubId,
                competition: nextMatch.competition_type || '⚽ Match',
                stadium: nextMatch.stadium_name || 'Stade inconnu'
              });
            }
          }
          
          // Attendre 500ms entre chaque requête pour éviter de surcharger l'API
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.error(`Erreur récupération match club ${clubId}:`, error);
        }
      }

      // Trier par date de match
      upcomingMatches.sort((a, b) => a.matchTime.getTime() - b.matchTime.getTime());

      if (upcomingMatches.length === 0) {
        const noMatchesEmbed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('📅 Aucun match à venir')
          .setDescription(`Aucun match programmé dans les 7 prochains jours pour les ${registeredClubs.length} club(s) inscrit(s).`)
          .addFields({
            name: '💡 Note',
            value: 'Les matchs plus lointains ne sont pas affichés pour éviter le spam.'
          })
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await statusMessage.edit({ embeds: [noMatchesEmbed] });
        return;
      }

      // Créer l'embed de résultats
      const resultsEmbed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('🏆 Prochains Résultats Programmés')
        .setDescription(`**${upcomingMatches.length}** match(s) surveillé(s) dans les 7 prochains jours`)
        .setTimestamp();

      // Diviser en groupes de 10 matchs maximum par embed
      const maxMatchesPerEmbed = 10;
      const matchesToShow = upcomingMatches.slice(0, maxMatchesPerEmbed);

      let matchList = '';
      const now = new Date();

      for (let i = 0; i < matchesToShow.length; i++) {
        const match = matchesToShow[i];
        const timeUntilMatch = match.matchTime.getTime() - now.getTime();
        const timeUntilResult = match.resultTime.getTime() - now.getTime();
        
        const hoursUntilMatch = Math.round(timeUntilMatch / (1000 * 60 * 60));
        const hoursUntilResult = Math.round(timeUntilResult / (1000 * 60 * 60));
        
        const venue = match.isHome ? '🏟️' : '✈️';
        const opponent = match.isHome ? match.awayClub : match.homeClub;
        
        matchList += `**${i + 1}.** ${venue} **${match.clubName}** vs **${opponent}**\n`;
        matchList += `   📅 ${match.matchTime.toLocaleDateString('fr-FR')} à ${match.matchTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}\n`;
        matchList += `   ⏰ Match dans ${hoursUntilMatch}h • Résultat dans ${hoursUntilResult}h\n`;
        matchList += `   🏆 ${match.competition}\n\n`;
      }

      resultsEmbed.addFields({
        name: '📋 Planning des notifications',
        value: matchList || 'Aucun match',
        inline: false
      });

      if (upcomingMatches.length > maxMatchesPerEmbed) {
        resultsEmbed.addFields({
          name: '📝 Note',
          value: `Affichage des ${maxMatchesPerEmbed} premiers matchs sur ${upcomingMatches.length} au total.`,
          inline: false
        });
      }

      // Statistiques
      const stats = matchResultWatcher.getResultStats();
      resultsEmbed.addFields({
        name: '📊 Configuration',
        value: 
          `**Clubs surveillés:** ${registeredClubs.length}\n` +
          `**Méthode:** ${stats.method}\n` +
          `**Matchs déjà traités:** ${stats.processedMatchesCount}`,
        inline: false
      });

      resultsEmbed.setFooter({ 
        text: 'Les résultats seront automatiquement notifiés 1 minute après chaque match • Soccerverse Bot v3.0' 
      });

      await statusMessage.edit({ embeds: [resultsEmbed] });

    } catch (error) {
      console.error('Erreur dans nextresults:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription('Une erreur est survenue lors de la récupération des prochains matchs.')
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        })
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await statusMessage.edit({ embeds: [errorEmbed] });
    }
  }
};
