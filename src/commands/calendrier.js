const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'calendrier',
  description: 'Afficher les prochains matchs d\'un club (inscrit ou spécifié)',
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
            value: '• `!calendrier` - Prochains matchs du club inscrit\n• `!calendrier <club_id>` - Prochains matchs d\'un club spécifique\n• `!calendrier <club_id> <nombre>` - Limiter le nombre de matchs'
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
          .setDescription(`Affichage des prochains matchs de **${apiClient.getClubName(clubId)}** (premier club inscrit).`)
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

      // 🔧 CORRECTION: Séparer matchs passés et futurs
      const now = Math.floor(Date.now() / 1000);
      const upcomingMatches = enrichedMatches
        .filter(match => match.date > now) // Seulement les matchs futurs
        .sort((a, b) => a.date - b.date); // Trier du plus proche au plus lointain

      if (upcomingMatches.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('📅 Aucun match à venir')
          .setDescription(`Aucun match à venir trouvé pour **${clubData.display_name}**.`)
          .addFields({
            name: '💡 Information',
            value: `Saison actuelle: ${seasonId}`
          })
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await message.reply({ embeds: [embed] });
        return;
      }

      // Limiter le nombre de matchs
      const matchesToShow = upcomingMatches.slice(0, limit);

      // Créer l'embed
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle(`📅 Prochains matchs - ${clubData.display_name}`)
        .setDescription(`**Saison ${seasonId}** - ${matchesToShow.length} prochain(s) match(s)`)
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
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        embed.addFields({
          name: `⏳ ${venue} ${opponent}`,
          value: `À venir • ${dateStr}\n${match.competition_type}`,
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
