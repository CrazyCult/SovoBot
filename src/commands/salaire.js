const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'salaire',
  description: 'Calculer le salaire club/match cible selon la position dans la ligue',
  usage: '!salaire <club_id>',
  
  /**
   * Calcule le nombre de matchs par équipe via get_all_turns
   */
  async calculateLeagueMatches(compId, seasonId, apiClient) {
    try {
      // 1. Récupérer tous les tours
      const turnsResponse = await apiClient.makeRpcRequest('get_all_turns', {
        comp_id: compId,
        season_id: seasonId
      });
      
      // La réponse contient result.data
      const turnsData = turnsResponse?.result?.data || turnsResponse?.data || turnsResponse;
      if (!Array.isArray(turnsData) || turnsData.length === 0) {
        return null;
      }
      
      const totalTurns = turnsData.length;
      
      // 2. Récupérer le classement pour compter les équipes
      // Utiliser get_standings qui existe vraiment
      const rankingResponse = await apiClient.makeRpcRequest('get_standings', {
        comp_id: compId,
        season_id: seasonId
      });
      
      const teamsData = rankingResponse?.result?.data || rankingResponse?.data || rankingResponse;
      if (!Array.isArray(teamsData) || teamsData.length === 0) {
        return null;
      }
      
      const nbEquipes = teamsData.length;
      
      // 3. Calculer le nombre de matchs par équipe
      let matchsParEquipe;
      
      if (nbEquipes % 2 === 0) {
        // Nombre PAIR → pas de repos
        matchsParEquipe = totalTurns;
      } else {
        // Nombre IMPAIR → avec repos
        // Formule: (nb_equipes - 1) × (total_tours / nb_equipes)
        const rounds = totalTurns / nbEquipes;
        matchsParEquipe = Math.floor((nbEquipes - 1) * rounds);
      }
      
      const matchsDomicile = Math.floor(matchsParEquipe / 2);
      
      console.log(`[SALAIRE] Calcul matchs - Tours: ${totalTurns}, Équipes: ${nbEquipes}, Matchs: ${matchsParEquipe}, Domicile: ${matchsDomicile}`);
      
      return {
        totalTurns,
        nbEquipes,
        matchsParEquipe,
        matchsDomicile,
        matchsExterieur: matchsParEquipe - matchsDomicile
      };
      
    } catch (error) {
      console.error('[SALAIRE] Erreur calcul matchs:', error);
      return null;
    }
  },
  
  async execute(message, args, { apiClient, dataManager }) {
    const channelId = message.channel.id;
    let clubId;

    // Si aucun argument, utiliser les clubs enregistrés
    if (args.length === 0) {
      const registeredClubs = dataManager.getChannelClubs(channelId);
      
      if (registeredClubs.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('💰 Aucun club inscrit')
          .setDescription('Ce salon n\'a aucun club inscrit aux notifications.')
          .addFields(
            {
              name: '💡 Usage',
              value: '• `!salaire` - Salaires du club inscrit\n• `!salaire <club_id>` - Salaires d\'un club spécifique',
              inline: false
            },
            {
              name: '📝 Exemple',
              value: '`!salaire 3227`',
              inline: false
            },
            {
              name: '📊 Informations affichées',
              value: 
                '• Salaire cible pour votre position actuelle\n' +
                '• Salaire pour le 1er du classement\n' +
                '• Salaire pour le milieu de tableau\n' +
                '• Salaire pour le dernier du classement',
              inline: false
            },
            {
              name: '📝 Pour s\'inscrire',
              value: '`!inscription <club_id>`',
              inline: false
            }
          )
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
        
        const infoEmbed = new EmbedBuilder()
          .setColor('#2196F3')
          .setTitle('📋 Plusieurs clubs inscrits')
          .setDescription(`Calcul des salaires pour **${apiClient.getClubName(clubId)}** (premier club inscrit).`)
          .addFields({
            name: '🏟️ Clubs inscrits dans ce salon',
            value: clubNames.join(', ') + (registeredClubs.length > 3 ? ` et ${registeredClubs.length - 3} autre(s)` : '')
          })
          .addFields({
            name: '💡 Pour un autre club',
            value: '`!salaire <club_id>`'
          })
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await message.reply({ embeds: [infoEmbed] });
      }
    } else {
      clubId = parseInt(args[0]);

      if (isNaN(clubId)) {
        const embed = new EmbedBuilder()
          .setColor('#FF6B6B')
          .setTitle('❌ ID invalide')
          .setDescription('Veuillez fournir un ID de club valide (nombre).')
          .setFooter({ text: 'Exemple: !salaire 3227' });
        
        await message.reply({ embeds: [embed] });
        return;
      }
    }

    // Message de chargement
    const loadingEmbed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('⏳ Calcul en cours...')
      .setDescription(`Récupération des données du club ${clubId}...`);
    
    const loadingMsg = await message.reply({ embeds: [loadingEmbed] });

    try {
      // Récupérer les données du club
      console.log(`[SALAIRE] Récupération club ${clubId}...`);
      const clubResponse = await apiClient.makeRpcRequest('get_club', { 
        club_id: clubId 
      });
      
      const clubData = clubResponse?.data || clubResponse;
      
      if (!clubData || !clubData.club_id) {
        console.log(`[SALAIRE] ❌ Club introuvable`);
        throw new Error('Club introuvable');
      }
      
      console.log(`[SALAIRE] ✅ Club trouvé:`, clubData.club_id);

      // Récupérer les données de la ligue
      const clubLeagueData = await apiClient.makeRpcRequest('get_clubs_league', { 
        club_id: clubId
      });
      
      let leagueId = null;
      const clubLeague = clubLeagueData?.data || clubLeagueData;
      
      if (Array.isArray(clubLeague) && clubLeague.length > 0) {
        leagueId = clubLeague[0].league_id;
      } else if (clubLeague && clubLeague.league_id) {
        leagueId = clubLeague.league_id;
      }

      if (!leagueId) {
        throw new Error('Ligue introuvable pour ce club');
      }

      // Récupérer les détails de la ligue
      const leagueResponse = await apiClient.makeRpcRequest('get_league', { 
        league_id: parseInt(leagueId) 
      });
      
      let leagueData = leagueResponse?.data || leagueResponse;
      const leagueInfo = Array.isArray(leagueData) ? leagueData[0] : leagueData;

      if (!leagueInfo) {
        throw new Error('Détails de ligue introuvables');
      }

      const compId = leagueInfo.comp_id;
      const seasonId = leagueInfo.season_id;

      // 🆕 NOUVEAU: Calculer le nombre de matchs automatiquement
      const matchData = await this.calculateLeagueMatches(compId, seasonId, apiClient);
      
      let homeMatches, totalMatches;
      
      if (matchData) {
        homeMatches = matchData.matchsDomicile;
        totalMatches = matchData.matchsParEquipe;
        console.log(`[SALAIRE] ✅ Matchs calculés automatiquement: ${totalMatches} (${homeMatches} domicile)`);
      } else {
        // Fallback: estimation basique
        homeMatches = 14;
        totalMatches = 28;
        console.log(`[SALAIRE] ⚠️ Utilisation valeurs par défaut`);
      }

      // Récupérer le classement
      const rankingResponse = await apiClient.makeRpcRequest('get_standings', {
        comp_id: compId,
        season_id: seasonId
      });

      const rankingData = rankingResponse?.result?.data || rankingResponse?.data || rankingResponse;
      
      if (!Array.isArray(rankingData) || rankingData.length === 0) {
        throw new Error('Classement introuvable');
      }

      const numClubs = rankingData.length;
      
      // Trouver la position du club
      const clubRanking = rankingData.find(club => club.club_id === clubId);
      const currentPosition = clubRanking ? clubRanking.position : null;

      // Fonction helper pour formater les salaires
      const formatSalary = (salary) => {
        if (salary >= 1000) {
          return `${(salary / 1000).toFixed(1)}M$`;
        }
        return `${salary.toFixed(1)}K$`;
      };

      // Calculer les salaires cibles pour différentes positions
      const baseFans = clubData.base_fans || 1000;
      const stadiumCapacity = clubData.stadium_capacity || 5000;
      const ticketPrice = clubData.ticket_price || 50;
      const tvRights = clubData.tv_rights || 50000;

      // Fonction pour calculer le salaire cible basé sur la position
      const calculateTargetSalary = (position) => {
        // Facteur de position (1er = 1.0, dernier = 0.3)
        const positionFactor = 1 - ((position - 1) / numClubs) * 0.7;
        
        // Calculer l'affluence estimée
        const attendance = Math.min(
          Math.floor(baseFans * positionFactor * 1.2),
          stadiumCapacity
        );
        
        // Revenus par match à domicile
        const ticketRevenue = attendance * ticketPrice;
        const tvRevenuePerMatch = tvRights / totalMatches;
        const merchandising = attendance * 15; // 15$ par fan en moyenne
        const sponsoring = baseFans * 5 * positionFactor; // Sponsoring variable
        
        const totalRevenuePerMatch = ticketRevenue + tvRevenuePerMatch + merchandising + sponsoring;
        
        // Budget salaire = 50-60% des revenus selon position
        const salaryBudgetRatio = 0.5 + (positionFactor * 0.1);
        const targetSalary = (totalRevenuePerMatch * salaryBudgetRatio) / 1000; // En K$
        
        // Revenus totaux pour la saison
        const seasonIncome = (ticketRevenue * homeMatches) + tvRights + (merchandising * homeMatches);
        
        // Prime estimée selon position
        let prize = 0;
        if (position === 1) prize = 500000;
        else if (position <= 3) prize = 300000;
        else if (position <= numClubs / 2) prize = 100000;
        
        return {
          salary: targetSalary,
          attendance,
          income: seasonIncome / 1000,
          prize: prize / 1000
        };
      };

      // Calculs pour différentes positions
      const firstPlace = calculateTargetSalary(1);
      const midTable = calculateTargetSalary(Math.ceil(numClubs / 2));
      const lastPlace = calculateTargetSalary(numClubs);
      const currentPos = currentPosition ? calculateTargetSalary(currentPosition) : null;

      // Créer l'embed
      const embed = new EmbedBuilder()
        .setColor('#FF6600')
        .setTitle(`💰 Salaires Cibles - ${clubData.name || `Club ${clubId}`}`)
        .setDescription(
          `Calculés pour une ligue de **${matchData ? matchData.nbEquipes : numClubs} clubs** avec **${totalMatches} matchs** au total ` +
          `(${homeMatches} à domicile)${matchData ? ' ✅' : ' ⚠️ estimation'}`
        );

      // Ajouter les données du club
      embed.addFields({
        name: '📊 Données du Club',
        value: 
          `👥 Base de fans: ${baseFans.toLocaleString('fr-FR')}\n` +
          `🏟️ Capacité stade: ${stadiumCapacity.toLocaleString('fr-FR')}\n` +
          `🎫 Prix billet: ${ticketPrice} SVC\n` +
          `📺 Droits TV: ${formatSalary(tvRights/1000)}/match`,
        inline: false
      });

      // Position actuelle
      if (currentPos && currentPosition) {
        embed.addFields({
          name: `🎯 Votre Position Actuelle (${currentPosition}${currentPosition === 1 ? 'er' : 'e'})`,
          value: 
            `💵 **Salaire cible: ${formatSalary(currentPos.salary)}/match**\n` +
            `👥 Affluence estimée: ${currentPos.attendance.toLocaleString('fr-FR')} fans\n` +
            `💰 Revenus saison: ${formatSalary(currentPos.income)}\n` +
            `🏆 Prime estimée: ${formatSalary(currentPos.prize)}`,
          inline: false
        });
      }

      embed.addFields(
        {
          name: '🥇 1er du Classement',
          value: 
            `💵 Salaire cible: **${formatSalary(firstPlace.salary)}/match**\n` +
            `👥 Affluence: ${firstPlace.attendance.toLocaleString('fr-FR')} fans`,
          inline: true
        },
        {
          name: `📊 Milieu de Tableau (${Math.ceil(numClubs / 2)}e)`,
          value: 
            `💵 Salaire cible: **${formatSalary(midTable.salary)}/match**\n` +
            `👥 Affluence: ${midTable.attendance.toLocaleString('fr-FR')} fans`,
          inline: true
        },
        {
          name: `📉 Dernier (${numClubs}e)`,
          value: 
            `💵 Salaire cible: **${formatSalary(lastPlace.salary)}/match**\n` +
            `👥 Affluence: ${lastPlace.attendance.toLocaleString('fr-FR')} fans`,
          inline: true
        }
      );

      embed.addFields({
        name: '💡 Recommandation',
        value: 
          `Avec ${homeMatches} matchs à domicile et ${totalMatches} matchs au total, ` +
          `visez un salaire club total proche de ces valeurs selon votre position dans le classement.`,
        inline: false
      });

      embed.setFooter({ text: `Soccerverse Bot v3.0 • Club ID: ${clubId}` });
      embed.setTimestamp();

      await loadingMsg.edit({ embeds: [embed] });

    } catch (error) {
      console.error('Erreur commande salaire:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription(`Impossible de calculer les salaires pour le club ${clubId}.`)
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        })
        .setFooter({ text: 'Vérifiez que l\'ID du club est correct.' });
      
      await loadingMsg.edit({ embeds: [errorEmbed] });
    }
  }
};
