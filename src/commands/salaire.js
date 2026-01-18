const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'salaire',
  description: 'Calculer le salaire club/match cible selon la position dans la ligue',
  usage: '!salaire <club_id>',
  
  /**
   * Calcule le nombre de matchs par équipe en comptant les équipes réelles
   */
  async calculateLeagueMatches(compId, seasonId, apiClient) {
    try {
      // 1. Récupérer tous les tours
      const turnsResponse = await apiClient.makeRpcRequest('get_all_turns', {
        comp_id: compId,
        season_id: seasonId
      });
      
      const result = turnsResponse?.result || turnsResponse;
      const turnsData = result?.data || result;
      
      if (!Array.isArray(turnsData) || turnsData.length === 0) {
        console.log('[SALAIRE] Pas de tours trouvés');
        return null;
      }
      
      const totalTurns = turnsData.length;
      const firstTurnId = turnsData[0].turn_id;
      
      console.log(`[SALAIRE] ${totalTurns} tours trouvés, analyse du tour ${firstTurnId}`);
      
      // 2. Récupérer les matchs du 1er tour pour compter les équipes
      const matchesResponse = await apiClient.makeRpcRequest('get_matches', {
        turn_id: firstTurnId
      });
      
      const matchesResult = matchesResponse?.result || matchesResponse;
      const matchesData = matchesResult?.data || matchesResult;
      
      let nbEquipes;
      
      if (Array.isArray(matchesData) && matchesData.length > 0) {
        const matchesInTurn = matchesData.length;
        // Nombre d'équipes = matchs × 2 (si tous jouent) ou matchs × 2 + 1 (si 1 au repos)
        nbEquipes = (matchesInTurn * 2) + 1; // On assume nombre impair par défaut
        console.log(`[SALAIRE] ${matchesInTurn} matchs au tour 1 → ${nbEquipes} équipes estimées`);
      } else {
        // Fallback si pas de matchs
        console.log('[SALAIRE] Pas de matchs trouvés, estimation par tours');
        nbEquipes = Math.round((totalTurns / 2) + 1);
      }
      
      // 3. Calculer le nombre de matchs par équipe
      let matchsParEquipe;
      
      if (nbEquipes % 2 === 0) {
        // Nombre PAIR → pas de repos, chaque tour = 1 match
        matchsParEquipe = totalTurns;
        console.log(`[SALAIRE] ${nbEquipes} équipes (PAIR) → ${matchsParEquipe} matchs`);
      } else {
        // Nombre IMPAIR → une équipe au repos chaque tour
        // Formule: matchs = (nb_equipes - 1) × (tours / nb_equipes)
        const rounds = totalTurns / nbEquipes;
        matchsParEquipe = Math.floor((nbEquipes - 1) * rounds);
        console.log(`[SALAIRE] ${nbEquipes} équipes (IMPAIR) → ${rounds.toFixed(1)} rounds → ${matchsParEquipe} matchs`);
      }
      
      const matchsDomicile = Math.floor(matchsParEquipe / 2);
      
      console.log(`[SALAIRE] RÉSULTAT: ${totalTurns} tours, ${nbEquipes} équipes, ${matchsParEquipe} matchs (${matchsDomicile} domicile)`);
      
      return {
        totalTurns,
        nbEquipes: Math.floor(nbEquipes),
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

      clubId = parseInt(registeredClubs[0]);
      
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

    const loadingEmbed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('⏳ Calcul en cours...')
      .setDescription(`Récupération des données du club ${clubId}...`);
    
    const loadingMsg = await message.reply({ embeds: [loadingEmbed] });

    try {
      console.log(`[SALAIRE] Récupération club ${clubId}...`);
      const clubResponse = await apiClient.makeRpcRequest('get_club', { 
        club_id: clubId 
      });
      
      const clubData = clubResponse?.data || clubResponse;
      
      if (!clubData || !clubData.club_id) {
        throw new Error('Club introuvable');
      }
      
      console.log(`[SALAIRE] ✅ Club trouvé: ${clubData.club_id}`);

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

      // 🔥 CALCUL AUTOMATIQUE DES MATCHS
      const matchData = await this.calculateLeagueMatches(compId, seasonId, apiClient);
      
      let homeMatches, totalMatches, numClubs;
      
      if (matchData) {
        homeMatches = matchData.matchsDomicile;
        totalMatches = matchData.matchsParEquipe;
        numClubs = matchData.nbEquipes;
        console.log(`[SALAIRE] ✅ Calculé: ${totalMatches} matchs (${homeMatches} domicile) pour ${numClubs} équipes`);
      } else {
        homeMatches = 14;
        totalMatches = 28;
        numClubs = 15;
        console.log(`[SALAIRE] ⚠️ Fallback: valeurs par défaut`);
      }

      // Récupérer le classement
      let leagueTable = [];
      let currentPosition = null;
      
      try {
        leagueTable = await apiClient.getLeagueTable(leagueId);
        
        if (!numClubs && leagueTable.length > 0) {
          numClubs = leagueTable.length;
        }
        
        const clubRanking = leagueTable.find(club => club.club_id === clubId);
        currentPosition = clubRanking ? clubRanking.new_position : null;
        
      } catch (error) {
        console.log('[SALAIRE] Classement indisponible');
      }

      const formatSalary = (salary) => {
        if (salary >= 1000) {
          return `${(salary / 1000).toFixed(1)}M$`;
        }
        return `${salary.toFixed(1)}K$`;
      };

      const baseFans = clubData.base_fans || 1000;
      const stadiumCapacity = clubData.stadium_capacity || 5000;
      const ticketPrice = clubData.ticket_price || 50;
      const tvRights = clubData.tv_rights || 50000;

      const calculateTargetSalary = (position) => {
        const positionFactor = 1 - ((position - 1) / numClubs) * 0.7;
        
        const attendance = Math.min(
          Math.floor(baseFans * positionFactor * 1.2),
          stadiumCapacity
        );
        
        const ticketRevenue = attendance * ticketPrice;
        const tvRevenuePerMatch = tvRights / totalMatches;
        const merchandising = attendance * 15;
        const sponsoring = baseFans * 5 * positionFactor;
        
        const totalRevenuePerMatch = ticketRevenue + tvRevenuePerMatch + merchandising + sponsoring;
        
        const salaryBudgetRatio = 0.5 + (positionFactor * 0.1);
        const targetSalary = (totalRevenuePerMatch * salaryBudgetRatio) / 1000;
        
        const seasonIncome = (ticketRevenue * homeMatches) + tvRights + (merchandising * homeMatches);
        
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

      const firstPlace = calculateTargetSalary(1);
      const midTable = calculateTargetSalary(Math.ceil(numClubs / 2));
      const lastPlace = calculateTargetSalary(numClubs);
      const currentPos = currentPosition ? calculateTargetSalary(currentPosition) : null;

      const embed = new EmbedBuilder()
        .setColor('#FF6600')
        .setTitle(`💰 Salaires Cibles - ${clubData.name || `Club ${clubId}`}`)
        .setDescription(
          `Calculés pour une ligue de **${numClubs} clubs** avec **${totalMatches} matchs** au total ` +
          `(${homeMatches} à domicile)${matchData ? ' ✅' : ' ⚠️'}`
        );

      embed.addFields({
        name: '📊 Données du Club',
        value: 
          `👥 Base de fans: ${baseFans.toLocaleString('fr-FR')}\n` +
          `🏟️ Capacité stade: ${stadiumCapacity.toLocaleString('fr-FR')}\n` +
          `🎫 Prix billet: ${ticketPrice} SVC\n` +
          `📺 Droits TV: ${formatSalary(tvRights/1000)}/saison`,
        inline: false
      });

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
