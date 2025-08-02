const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'calendrier',
  description: 'Afficher le calendrier des prochains matchs d\'un club (inscrit ou spécifié)',
  usage: '!calendrier [club_id] [nombre_matchs]',
  
  async execute(message, args, { apiClient, dataManager }) {
    const channelId = message.channel.id;
    let clubId;
    let limit = 5; // Par défaut 5 matchs

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
            value: '• `!calendrier` - Calendrier du club inscrit\n• `!calendrier <club_id>` - Calendrier d\'un club spécifique\n• `!calendrier <club_id> <nombre>` - Limiter le nombre de matchs'
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
          .setDescription(`Affichage du calendrier de **${apiClient.getClubName(clubId)}** (premier club inscrit).`)
          .addFields({
            name: '🏟️ Clubs inscrits dans ce salon',
            value: clubNames.join(', ') + (registeredClubs.length > 3 ? `... et ${registeredClubs.length - 3} autre(s)` : '')
          })
          .addFields({
            name: '💡 Astuce',
            value: 'Utilisez `!calendrier <club_id>` pour un club spécifique'
          })
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await message.reply({ embeds: [embed] });
      }
    } else {
      // Arguments fournis
      clubId = parseInt(args[0]);
      limit = args[1] ? Math.min(parseInt(args[1]) || 5, 20) : 5; // Max 20 matchs
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

      // APPROCHE SIMPLE: Utiliser directement get_club_schedule comme dans getClubSchedule mais sans getCurrentSeason
      let allMatches = [];
      let seasonId = 2; // Commencer par la saison 2
      
      // Tester saison 2 puis 1
      for (const testSeason of [2, 1]) {
        try {
          console.log(`🔍 Test saison ${testSeason} pour club ${clubId}`);
          
          const result = await apiClient.makeRpcRequest('get_club_schedule', {
            club_id: parseInt(clubId),
            season_id: testSeason
          });
          
          console.log(`📊 Réponse brute:`, result);
          
          // CORRECTION: Les données sont dans result.data comme dans votre script Python
          let matches = null;
          if (result && result.data && Array.isArray(result.data)) {
            matches = result.data;
          } else if (result && Array.isArray(result)) {
            matches = result;
          }
          
          if (matches && matches.length > 0) {
            allMatches = matches;
            seasonId = testSeason;
            console.log(`✅ Calendrier trouvé en saison ${testSeason} avec ${matches.length} matchs`);
            break;
          } else {
            console.log(`⚠️ Saison ${testSeason}: aucun match trouvé`);
          }
        } catch (error) {
          console.log(`⚠️ Saison ${testSeason} échouée: ${error.message}`);
        }
      }
      
      if (allMatches.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('⚠️ Aucun match trouvé')
          .setDescription(`Aucun calendrier disponible pour ${clubData.display_name}.`)
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await message.reply({ embeds: [embed] });
        return;
      }

      // Trier par date croissante et prendre les prochains matchs
      const now = Math.floor(Date.now() / 1000);
      const upcomingMatches = allMatches
        .sort((a, b) => a.date - b.date) // Tri chronologique
        .filter(match => match.date >= now) // Matchs futurs
        .slice(0, limit); // Limiter
      
      if (upcomingMatches.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('📅 Aucun match à venir')
          .setDescription(`${clubData.display_name} n'a pas de matchs programmés.`)
          .addFields({
            name: '📊 Informations',
            value: `**Saison:** ${seasonId}\n**Matchs totaux:** ${allMatches.length}`
          })
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await message.reply({ embeds: [embed] });
        return;
      }

      // Créer l'embed principal
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle(`📅 Calendrier de ${clubData.display_name}`)
        .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`)
        .setDescription(`**Manager:** ${clubData.manager_name}\n**Pays:** ${apiClient.formatCountryName(clubData.country_id)}\n**Saison:** ${seasonId}`);

      // Ajouter chaque match à venir
      let matchList = '';
      upcomingMatches.forEach((match, index) => {
        const matchDate = new Date(match.date * 1000);
        const isHome = match.home_club == clubId;
        const opponentId = isHome ? match.away_club : match.home_club;
        const opponentName = apiClient.getClubName(opponentId);
        const venue = isHome ? '🏟️' : '✈️';
        const competition = apiClient.getCompetitionType(match.comp_type);
        
        // Formatage de la date
        const dateStr = matchDate.toLocaleDateString('fr-FR');
        const timeStr = matchDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        
        // Temps restant
        const timeUntil = apiClient.formatMatchDate(match.date);
        
        matchList += `**${index + 1}.** ${venue} vs **${opponentName}**\n`;
        matchList += `📅 ${dateStr} à ${timeStr} • ⏳ ${timeUntil}\n`;
        matchList += `🏆 ${competition}\n\n`;
      });

      embed.addFields({
        name: `⚽ ${upcomingMatches.length} prochains matchs`,
        value: matchList,
        inline: false
      });

      // Informations supplémentaires
      embed.addFields({
        name: '📋 Informations',
        value: `**ID Club:** ${clubId}\n**Division:** ${clubData.division + 1}\n**Stade:** ${apiClient.getStadiumName(clubData.stadium_id)}`,
        inline: false
      });

      embed.setFooter({ text: `Club ID: ${clubId} • Saison ${seasonId} • Soccerverse Bot v3.0` })
           .setTimestamp();

      await message.reply({ embeds: [embed] });

    } catch (error) {
      console.error('❌ Erreur dans la commande calendrier:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription('Une erreur est survenue lors de la récupération du calendrier.')
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
  }
};