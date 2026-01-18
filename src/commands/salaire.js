const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'salaire',
  description: 'Calculer le salaire club/match cible selon la position dans la ligue',
  usage: '!salaire <club_id>',
  
  async execute(message, args, { apiClient, dataManager }) {
    // Vérifier qu'un ID de club est fourni
    if (args.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('💰 Calculateur de Salaire Cible')
        .setDescription('Calculez le salaire club/match recommandé selon votre position dans la ligue.')
        .addFields(
          {
            name: '💡 Usage',
            value: '`!salaire <club_id>`',
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
          }
        )
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const clubId = parseInt(args[0]);

    if (isNaN(clubId)) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ ID invalide')
        .setDescription('Veuillez fournir un ID de club valide (nombre).')
        .setFooter({ text: 'Exemple: !salaire 3227' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    // Message de chargement
    const loadingEmbed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('⏳ Calcul en cours...')
      .setDescription(`Récupération des données du club ${clubId}...`);
    
    const loadingMsg = await message.reply({ embeds: [loadingEmbed] });

    try {
      // Récupérer les données du club
      const clubData = await apiClient.makeRpcRequest('get_club', { name: clubId.toString() });
      
      if (!clubData || !clubData.club_id) {
        throw new Error('Club introuvable');
      }

      // Récupérer les données de la ligue
      const clubLeagueData = await apiClient.makeRpcRequest('get_clubs_league', { 
        club_ids: [clubId.toString()] 
      });
      
      let leagueId = null;
      if (clubLeagueData && Array.isArray(clubLeagueData)) {
        const clubLeague = clubLeagueData.find(cl => cl.club_id === clubId.toString());
        if (clubLeague && clubLeague.league_id) {
          leagueId = clubLeague.league_id;
        }
      }

      if (!leagueId) {
        throw new Error('Ligue introuvable pour ce club');
      }

      // Récupérer les détails de la ligue
      const leagueData = await apiClient.makeRpcRequest('get_league', { 
        league_id: leagueId.toString() 
      });

      const leagueInfo = Array.isArray(leagueData) ? leagueData[0] : leagueData;

      // Récupérer le classement
      const leagueTable = await apiClient.makeRpcRequest('get_league_table', { 
        league_id: leagueId.toString() 
      });

      const numClubs = leagueTable ? leagueTable.length : 20;
      
      // Trouver la position du club
      let clubPosition = null;
      if (leagueTable) {
        const clubEntry = leagueTable.find(entry => entry.club_id === clubId.toString());
        if (clubEntry) {
          clubPosition = clubEntry.position;
        }
      }

      // Extraire les données financières
      const fanBase = clubData.fans_current || 0;
      const stadiumCapacity = clubData.stadium_size_current || 0;
      const ticketPrice = (leagueInfo.ticket_cost || 0) / 10000;
      const tvMoney = (leagueInfo.tv_money || 0) / 1000;

      // Calculer les matchs
      const apiRounds = leagueInfo.round || 1;
      const matchesPerTour = numClubs - 1;
      let maxTours = Math.floor(apiRounds / matchesPerTour);
      
      if (maxTours === 0 && apiRounds > 0) {
        maxTours = 2; // Saison complète par défaut
      }
      
      const totalMatches = maxTours * matchesPerTour;
      const homeMatches = totalMatches / 2;

      // Fonction de calcul de salaire cible
      const calculateTargetSalary = (position, numClubs) => {
        const midTable = numClubs / 2;
        let attendance = fanBase;
        
        if (position < midTable) {
          const units = midTable - position;
          const deltaFans = (fanBase / 30) * units;
          attendance = fanBase + deltaFans;
        } else if (position > midTable) {
          const units = position - midTable;
          const deltaFans = (fanBase / 30) * units;
          attendance = fanBase - deltaFans;
        }
        
        attendance = Math.round(Math.min(attendance, stadiumCapacity));
        
        const gateReceipts = (attendance * ticketPrice) * 0.8;
        const sponsorship = (attendance * ticketPrice) * 0.3;
        const merchandise = (attendance * ticketPrice) * 0.1;
        const tvMoneyPerMatch = tvMoney;
        
        const totalHomeIncome = (gateReceipts + sponsorship + merchandise) * homeMatches;
        const totalTvMoney = tvMoneyPerMatch * totalMatches;
        const totalSeasonIncome = totalHomeIncome + totalTvMoney;
        
        const stadiumMaintenancePerMatch = 0.20 * (attendance * ticketPrice);
        const stadiumMaintenance = stadiumMaintenancePerMatch * homeMatches;
        
        const leagueWageEstimate = 8000000;
        const prizePot = leagueWageEstimate * 0.12;
        const estimatedPrizeMoney = (prizePot / numClubs) * (1 + (0.05 * (numClubs - position)));
        
        const totalBudgetForSalaries = (totalSeasonIncome + estimatedPrizeMoney) - stadiumMaintenance;
        const targetClubSalaryPerMatch = totalBudgetForSalaries / totalMatches;
        
        return {
          salary: targetClubSalaryPerMatch,
          attendance: attendance,
          income: totalSeasonIncome,
          prize: estimatedPrizeMoney
        };
      };

      // Calculer pour différentes positions
      const firstPlace = calculateTargetSalary(1, numClubs);
      const midTable = calculateTargetSalary(Math.ceil(numClubs / 2), numClubs);
      const lastPlace = calculateTargetSalary(numClubs, numClubs);
      const currentPos = clubPosition ? calculateTargetSalary(clubPosition, numClubs) : null;

      // Créer l'embed de réponse
      const clubName = apiClient.getClubName(clubId);
      
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle(`💰 Salaires Cibles - ${clubName}`)
        .setDescription(`Calculés pour une ligue de **${numClubs} clubs** avec **${totalMatches} matchs** au total`)
        .addFields(
          {
            name: '📊 Données du Club',
            value: 
              `👥 Base de fans: **${fanBase.toLocaleString('fr-FR')}**\n` +
              `🏟️ Capacité stade: **${stadiumCapacity.toLocaleString('fr-FR')}**\n` +
              `🎫 Prix billet: **${ticketPrice.toFixed(2)} SVC**\n` +
              `📺 Droits TV: **${(tvMoney / 1000).toFixed(1)} k SVC**/match`,
            inline: false
          }
        );

      if (currentPos && clubPosition) {
        embed.addFields({
          name: `🎯 Votre Position Actuelle (${clubPosition}${clubPosition === 1 ? 'er' : 'e'})`,
          value: 
            `💵 **Salaire cible: ${apiClient.formatMoney(currentPos.salary)}/match**\n` +
            `👥 Affluence estimée: ${currentPos.attendance.toLocaleString('fr-FR')} fans\n` +
            `💰 Revenus saison: ${apiClient.formatMoney(currentPos.income)}\n` +
            `🏆 Prime estimée: ${apiClient.formatMoney(currentPos.prize)}`,
          inline: false
        });
      }

      embed.addFields(
        {
          name: '🥇 1er du Classement',
          value: 
            `💵 Salaire cible: **${apiClient.formatMoney(firstPlace.salary)}/match**\n` +
            `👥 Affluence: ${firstPlace.attendance.toLocaleString('fr-FR')} fans`,
          inline: true
        },
        {
          name: `📊 Milieu de Tableau (${Math.ceil(numClubs / 2)}e)`,
          value: 
            `💵 Salaire cible: **${apiClient.formatMoney(midTable.salary)}/match**\n` +
            `👥 Affluence: ${midTable.attendance.toLocaleString('fr-FR')} fans`,
          inline: true
        },
        {
          name: `📉 Dernier (${numClubs}e)`,
          value: 
            `💵 Salaire cible: **${apiClient.formatMoney(lastPlace.salary)}/match**\n` +
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
