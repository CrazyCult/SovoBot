const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

class MatchResultWatcher {
  constructor(client, dataManager, apiClient) {
    this.client = client;
    this.dataManager = dataManager;
    this.apiClient = apiClient;
    
    // Cache des matchs en cours pour éviter les doublons
    this.processedMatches = new Map();
    
    // Intervalle de vérification (toutes les 2 minutes)
    this.checkInterval = 2 * 60 * 1000;
    
    // Délai après début du match pour récupérer le résultat (1 minute)
    this.resultDelay = 1 * 60 * 1000;
    
    this.startWatching();
  }

  startWatching() {
    // Vérification initiale après 1 minute
    setTimeout(() => {
      this.scheduleNextChecks();
    }, 60000);
    
    // Puis re-programmer toutes les heures pour recalculer les prochains matchs
    setInterval(() => {
      this.scheduleNextChecks();
    }, 60 * 60 * 1000); // Toutes les heures
    
    logger.info('⚽ Surveillance des résultats de match démarrée (programmation intelligente)');
  }

  async scheduleNextChecks() {
    try {
      const registeredClubs = this.dataManager.getAllRegisteredClubs();
      
      if (registeredClubs.length === 0) {
        return;
      }
      
      logger.debug(`📅 Programmation des vérifications pour ${registeredClubs.length} club(s)`);
      
      for (const clubId of registeredClubs) {
        try {
          await this.scheduleClubResultCheck(parseInt(clubId));
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1s entre chaque club
        } catch (error) {
          logger.error(`Erreur programmation club ${clubId}:`, error);
        }
      }
      
    } catch (error) {
      logger.error('Erreur programmation vérifications:', error);
    }
  }

  async scheduleClubResultCheck(clubId) {
    try {
      // Récupérer le prochain match du club
      const nextMatch = await this.apiClient.getClubNextMatch(clubId);
      
      if (!nextMatch) {
        return;
      }
      
      const matchTime = new Date(nextMatch.date * 1000);
      const now = new Date();
      
      // NOUVEAU: Ajouter un délai aléatoire pour éviter le spam simultané
      const randomDelay = Math.floor(Math.random() * 300000); // 0-5 minutes aléatoire
      const checkTime = new Date(matchTime.getTime() + this.resultDelay + randomDelay);
      
      // Seulement programmer si le match est dans les prochaines 24h
      const timeDiff = matchTime.getTime() - now.getTime();
      if (timeDiff <= 0 || timeDiff > 24 * 60 * 60 * 1000) {
        return;
      }
      
      // Calculer le délai jusqu'à la vérification
      const delayUntilCheck = checkTime.getTime() - now.getTime();
      
      if (delayUntilCheck > 0 && delayUntilCheck <= 24 * 60 * 60 * 1000) {
        // Programmer la vérification avec délai aléatoire
        setTimeout(async () => {
          logger.info(`⏰ Vérification programmée pour club ${clubId} - Match: ${matchTime.toLocaleString('fr-FR')}`);
          await this.checkSpecificClubResult(clubId, nextMatch.fixture_id || nextMatch.date);
        }, delayUntilCheck);
        
        const delayMinutes = Math.round(delayUntilCheck / 60000);
        const randomMinutes = Math.round(randomDelay / 60000);
        logger.debug(`📅 Club ${clubId}: vérification dans ${delayMinutes}min (délai anti-spam: +${randomMinutes}min)`);
      }
      
    } catch (error) {
      logger.error(`Erreur programmation club ${clubId}:`, error);
    }
  }

  async checkSpecificClubResult(clubId, expectedMatchId) {
    try {
      // NOUVEAU: Ajouter un délai avant la requête pour éviter le spam
      const randomWait = Math.floor(Math.random() * 10000); // 0-10 secondes
      await new Promise(resolve => setTimeout(resolve, randomWait));
      
      // Récupérer le dernier match du club
      const lastMatch = await this.apiClient.getClubLastMatch(clubId);
      
      if (!lastMatch) {
        logger.debug(`Aucun dernier match trouvé pour club ${clubId}`);
        return;
      }
      
      // Vérifier si c'est bien le match attendu
      const matchId = lastMatch.fixture_id || lastMatch.date;
      if (matchId !== expectedMatchId) {
        logger.debug(`Match différent de celui attendu pour club ${clubId}: ${matchId} vs ${expectedMatchId}`);
        return;
      }
      
      // Vérifier si le match est terminé
      if (lastMatch.played !== 1) {
        logger.debug(`Match ${matchId} pas encore terminé pour club ${clubId}, re-programmer dans 5 minutes`);
        // Re-programmer dans 5 minutes avec nouveau délai aléatoire
        const retryDelay = (5 * 60 * 1000) + Math.floor(Math.random() * 60000); // 5-6 minutes
        setTimeout(async () => {
          await this.checkSpecificClubResult(clubId, expectedMatchId);
        }, retryDelay);
        return;
      }
      
      // Créer une clé unique pour ce match
      const matchKey = `${clubId}_${matchId}_${lastMatch.home_goals}_${lastMatch.away_goals}`;
      
      // Vérifier si on a déjà envoyé la notification
      if (this.processedMatches.has(matchKey)) {
        logger.debug(`Notification déjà envoyée pour ${matchKey}`);
        return;
      }
      
      // Marquer comme traité et envoyer la notification
      this.processedMatches.set(matchKey, {
        timestamp: Date.now(),
        clubId: clubId,
        matchData: lastMatch
      });
      
      await this.sendMatchResultNotification(clubId, lastMatch);
      
    } catch (error) {
      // Si erreur 429 ou timeout, re-programmer plus tard
      if (error.message.includes('429') || error.message.includes('timeout')) {
        const retryDelay = (10 * 60 * 1000) + Math.floor(Math.random() * 300000); // 10-15 minutes
        logger.warn(`Rate limit/timeout pour club ${clubId}, retry dans ${Math.round(retryDelay/60000)} minutes`);
        setTimeout(async () => {
          await this.checkSpecificClubResult(clubId, expectedMatchId);
        }, retryDelay);
      } else {
        logger.error(`Erreur vérification spécifique club ${clubId}:`, error);
      }
    }
  }

  async sendMatchResultNotification(clubId, match) {
    try {
      const channelsForClub = this.dataManager.getChannelsForClub(clubId);
      
      if (channelsForClub.length === 0) {
        return;
      }
      
      const embed = await this.createMatchResultEmbed(clubId, match);
      
      for (const channelId of channelsForClub) {
        try {
          const channel = this.client.channels.cache.get(channelId);
          if (!channel) {
            logger.warn(`Canal ${channelId} introuvable pour notification résultat`);
            continue;
          }
          
          await channel.send({ embeds: [embed] });
          
        } catch (error) {
          logger.error(`Erreur envoi notification résultat canal ${channelId}:`, error);
        }
      }
      
      logger.info(`🏆 Notification résultat envoyée: Club ${clubId}, Score ${match.home_goals}-${match.away_goals}, ${channelsForClub.length} canal(aux)`);
      
    } catch (error) {
      logger.error('Erreur envoi notification résultat:', error);
    }
  }

  async createMatchResultEmbed(clubId, match) {
    const clubName = this.apiClient.getClubName(clubId);
    const matchTime = new Date(match.date * 1000);
    
    const isHome = match.home_club == clubId;
    const opponentId = isHome ? match.away_club : match.home_club;
    const opponentName = this.apiClient.getClubName(opponentId);
    const venue = isHome ? '🏟️ Domicile' : '✈️ Extérieur';
    
    // Déterminer le résultat pour le club
    const clubGoals = isHome ? match.home_goals : match.away_goals;
    const opponentGoals = isHome ? match.away_goals : match.home_goals;
    
    let matchResult = '';
    let embedColor = '';
    let resultEmoji = '';
    
    if (clubGoals > opponentGoals) {
      matchResult = '🎉 **VICTOIRE !**';
      embedColor = '#4CAF50'; // Vert
      resultEmoji = '🟢';
    } else if (clubGoals < opponentGoals) {
      matchResult = '😔 **Défaite**';
      embedColor = '#F44336'; // Rouge
      resultEmoji = '🔴';
    } else {
      matchResult = '🤝 **Match Nul**';
      embedColor = '#FF9800'; // Orange
      resultEmoji = '🟡';
    }
    
    // Score formaté
    const finalScore = `${match.home_goals} - ${match.away_goals}`;
    
    // Détails du match
    const homeTeam = this.apiClient.getClubName(match.home_club);
    const awayTeam = this.apiClient.getClubName(match.away_club);
    
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`⚽ Résultat de Match - ${clubName}`)
      .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`)
      .setDescription(`${matchResult}\n${resultEmoji} **${finalScore}**`)
      .addFields(
        {
          name: '🏟️ Match',
          value: `**${homeTeam}** ${match.home_goals} - ${match.away_goals} **${awayTeam}**\n📍 ${venue}\n🏟️ ${match.stadium_name || 'Stade inconnu'}\n📅 ${matchTime.toLocaleDateString('fr-FR')} à ${matchTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}\n🏆 ${match.competition_type || '⚽ Match'}`,
          inline: false
        },
        {
          name: '📊 Performance de votre club',
          value: `**${clubName}**\n⚽ **Buts marqués:** ${clubGoals}\n🥅 **Buts encaissés:** ${opponentGoals}\n📍 **Lieu:** ${venue}`,
          inline: true
        },
        {
          name: '🆚 Adversaire',
          value: `**${opponentName}**\n⚽ **Buts marqués:** ${opponentGoals}\n🥅 **Buts encaissés:** ${clubGoals}\n👤 **Entraîneur:** ${isHome ? match.away_manager : match.home_manager || 'Inconnu'}`,
          inline: true
        }
      );
    
    // Ajouter des statistiques supplémentaires si disponibles
    if (match.attendance) {
      embed.addFields({
        name: '👥 Affluence',
        value: `${match.attendance.toLocaleString()} spectateurs`,
        inline: true
      });
    }
    
    // Ajouter un lien vers le club sur Soccerverse
    embed.addFields({
      name: '🔗 Actions',
      value: `[Voir le club sur Soccerverse](https://play.soccerverse.com/club/${clubId})`,
      inline: false
    });
    
    // Message contextuel selon le résultat
    let contextMessage = '';
    if (clubGoals > opponentGoals) {
      contextMessage = '🎊 Félicitations pour cette belle victoire !';
    } else if (clubGoals < opponentGoals) {
      contextMessage = '💪 Ce n\'est qu\'un match, l\'important c\'est de continuer !';
    } else {
      contextMessage = '⚖️ Un point de pris face à un adversaire coriace !';
    }
    
    embed.setFooter({ 
      text: `${contextMessage} • Soccerverse Bot v3.0` 
    })
    .setTimestamp();

    return embed;
  }

  cleanupProcessedMatches() {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    for (const [key, matchData] of this.processedMatches.entries()) {
      if (matchData.timestamp < oneDayAgo) {
        this.processedMatches.delete(key);
      }
    }
    
    logger.debug(`🧹 Nettoyage matchs traités: ${this.processedMatches.size} restants`);
  }

  // Méthodes utilitaires pour l'administration

  getResultStats() {
    return {
      processedMatchesCount: this.processedMatches.size,
      schedulingInterval: '1 heure', // Reprogrammation
      resultDelay: this.resultDelay / 60000, // en minutes
      method: 'Programmation précise basée sur les horaires de match'
    };
  }

  async forceCheckResults() {
    logger.info('🔄 Vérification forcée des résultats de match...');
    await this.scheduleNextChecks();
  }

  resetResultCache() {
    this.processedMatches.clear();
    logger.info('🔄 Cache des résultats réinitialisé');
  }

  // Debug: Afficher les matchs traités récemment
  debugProcessedMatches() {
    logger.debug('=== MATCHS TRAITÉS DEBUG ===');
    for (const [key, matchData] of this.processedMatches.entries()) {
      const timeAgo = Math.round((Date.now() - matchData.timestamp) / 60000);
      logger.debug(`${key}: il y a ${timeAgo} minutes - Club ${matchData.clubId}`);
    }
    logger.debug('=== FIN DEBUG MATCHS ===');
  }
}

module.exports = MatchResultWatcher;
