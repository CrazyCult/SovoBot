const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'salaire',
  description: 'Calculer le salaire club/match cible selon la position dans la ligue',
  usage: '!salaire <club_id>',
  
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
      // Récupérer les données du club via getClubDetails (comme les autres commandes)
      const clubData = await apiClient.getClubDetails(clubId);
      
      if (!clubData || !clubData.club_id) {
        throw new Error('Club introuvable');
      }

      // Récupérer les données de la ligue
      const clubLeagueData = await apiClient.makeRpcRequest('get_clubs_league', { 
        club_id: clubId  // Singulier, comme dans le HTML qui fonctionne
      });
      
      let leagueId = null;
      // La réponse contient .data comme dans le HTML
      const clubLeague = clubLeagueData?.data || clubLeagueData;
      
      if (Array.isArray(clubLeague) && clubLeague.length > 0) {
        // Si c'est un array, prendre le premier élément
        const firstLeague = clubLeague[0];
        leagueId = firstLeague.league_id;
      } else if (clubLeague && clubLeague.league_id) {
        // Si c'est un objet direct
        leagueId = clubLeague.league_id;
      }

      if (!leagueId) {
        throw new Error('Ligue introuvable pour ce club');
      }

      // Récupérer les détails de la ligue
      const leagueResponse = await apiClient.makeRpcRequest('get_league', { 
        league_id: parseInt(leagueId) 
      });
      
      // Extraire .data comme dans le HTML
      let leagueData = leagueResponse?.data || leagueResponse;
      const leagueInfo = Array.isArray(leagueData) ? leagueData[0] : leagueData;

      // Récupérer le classement
      const leagueTableResponse = await apiClient.makeRpcRequest('get_league_table', { 
        league_id: parseInt(leagueId) 
      });
      
      // Extraire .data comme dans le HTML qui fonctionne
      const leagueTable = leagueTableResponse?.data || leagueTableResponse;

      const numClubs = Array.isArray(leagueTable) ? leagueTable.length : 20;
      
      // Trouver la position du club
      let clubPosition = null;
      if (Array.isArray(leagueTable)) {
        const clubEntry = leagueTable.find(entry => parseInt(entry.club_id) === clubId);
        if (clubEntry) {
          clubPosition = clubEntry.position;
        }
      }

      // Extraire les données financières
      const fanBase = clubData.fans_current || 0;
      const stadiumCapacity = clubData.stadium_size_current || 0;
      const ticketPrice = (leagueInfo.ticket_cost || 0) / 10000;
      const tvMoney = (leagueInfo.tv_money || 0) / 10000; // Diviser par 10000 comme le HTML

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

      // Fonction locale pour formater les salaires (déjà en dollars)
      const formatSalary = (amount) => {
        if (!amount || amount === 0) return '0$';
        
        if (amount >= 1000000000) {
          return `${(amount / 1000000000).toFixed(1)}B$`;
        } else if (amount >= 1000000) {
          return `${(amount / 1000000).toFixed(1)}M$`;
        } else if (amount >= 1000) {
          return `${(amount / 1000).toFixed(1)}K$`;
        } else {
          return `${Math.round(amount).toLocaleString('fr-FR')}$`;
        }
      };

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
