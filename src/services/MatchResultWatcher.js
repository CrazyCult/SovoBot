const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

class MatchResultWatcher {
  constructor(client, dataManager, apiClient) {
    this.client = client;
    this.dataManager = dataManager;
    this.apiClient = apiClient;
    
    // Cache des matchs traités pour éviter les doublons
    this.processedMatches = new Map();
    
    // ✅ OPTIMISATION: Intervalle à 30 secondes
    // Balance entre réactivité et charge API
    this.checkInterval = 30 * 1000; // 30 secondes
    
    // ✅ CORRECTION MAJEURE: Premier essai 15 secondes après le match
    // Puis 3 tentatives espacées de 30 secondes
    this.firstAttemptDelay = 15 * 1000; // 15 secondes
    this.retryDelay = 30 * 1000; // 30 secondes entre tentatives
    this.maxRetries = 3; // 3 tentatives maximum
    
    // Tracking des tentatives par match
    this.matchAttempts = new Map(); // {matchKey: {attempts: number, lastAttempt: timestamp}}
    
    // ✅ OPTIMISATION: Délai entre notifications (clubs au même horaire)
    // Évite le spam quand plusieurs clubs jouent à 20h00
    this.notificationDelay = 10 * 1000; // 10 secondes
    
    this.startWatching();
  }

  startWatching() {
    setTimeout(() => {
      this.checkRecentMatches();
    }, 30000);
    
    setInterval(() => {
      this.checkRecentMatches();
    }, this.checkInterval);
    
    logger.info('⚽ Surveillance résultats démarrée (3min, délai 10min après match)');
  }

  async checkRecentMatches() {
    try {
      const registeredClubs = this.dataManager.getAllRegisteredClubs();
      
      if (registeredClubs.length === 0) {
        return;
      }
      
      logger.debug(`⚽ Vérification résultats pour ${registeredClubs.length} club(s)`);
      
      // ✅ Échelonner les vérifications pour éviter le spam
      const clubsToCheck = [];
      
      for (const clubId of registeredClubs) {
        clubsToCheck.push({
          clubId: parseInt(clubId),
          delay: clubsToCheck.length * this.notificationDelay
        });
      }
      
      for (const {clubId, delay} of clubsToCheck) {
        setTimeout(async () => {
          try {
            await this.checkClubRecentResult(clubId);
          } catch (error) {
            logger.error(`Erreur vérification club ${clubId}:`, error);
          }
        }, delay);
      }
      
      this.cleanupProcessedMatches();
      
    } catch (error) {
      logger.error('Erreur surveillance résultats globale:', error);
    }
  }

  async checkClubRecentResult(clubId) {
    try {
      const lastMatch = await this.apiClient.getClubLastMatch(clubId);
      
      if (!lastMatch) {
        return;
      }
      
      const matchTime = new Date(lastMatch.date * 1000);
      const now = new Date();
      
      // ✅ Fenêtre: 10 minutes à 6 heures après le match
      const timeSinceMatch = now.getTime() - matchTime.getTime();
      const minDelay = this.resultDelay; // 10 minutes
      const maxDelay = 6 * 60 * 60 * 1000; // 6 heures
      
      if (timeSinceMatch < minDelay || timeSinceMatch > maxDelay) {
        return;
      }
      
      // ✅ Vérifier played=1 (disponible via get_club_schedule)
      if (lastMatch.played !== 1) {
        logger.debug(`Match ${lastMatch.fixture_id} club ${clubId} pas terminé (played=${lastMatch.played})`);
        return;
      }
      
      const matchKey = `${clubId}_${lastMatch.fixture_id}_${lastMatch.home_goals}_${lastMatch.away_goals}`;
      
      if (this.processedMatches.has(matchKey)) {
        return;
      }
      
      this.processedMatches.set(matchKey, {
        timestamp: Date.now(),
        clubId: clubId,
        matchData: lastMatch
      });
      
      logger.info(`🏆 Résultat: Club ${clubId}, Score ${lastMatch.home_goals}-${lastMatch.away_goals}`);
      
      await this.sendMatchResultNotification(clubId, lastMatch);
      
    } catch (error) {
      if (error.message.includes('429') || error.message.includes('timeout')) {
        logger.warn(`Rate limit/timeout club ${clubId}, skip`);
      } else {
        logger.error(`Erreur vérification club ${clubId}:`, error);
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
            logger.warn(`Canal ${channelId} introuvable`);
            continue;
          }
          
          // ✅ MENTION POUR NOTIFICATION: Récupérer qui a inscrit le club
          const mentionIds = this.getMentionIdsForClub(channelId, clubId);
          const mentions = mentionIds.length > 0 ? mentionIds.map(id => `<@${id}>`).join(' ') : undefined;
          
          await channel.send({ 
            content: mentions, // 🔔 Déclenche la notification Discord
            embeds: [embed] 
          });
          
        } catch (error) {
          logger.error(`Erreur envoi canal ${channelId}:`, error);
        }
      }
      
      logger.info(`🏆 Notification envoyée: Club ${clubId}, ${channelsForClub.length} canal(aux)`);
      
    } catch (error) {
      logger.error('Erreur envoi notification résultat:', error);
    }
  }

  getMentionIdsForClub(channelId, clubId) {
    const clubIdStr = clubId.toString();
    const channelClubs = this.dataManager.data.registrations.get(channelId);
    
    if (!channelClubs) return [];
    
    const clubInfo = channelClubs.get(clubIdStr);
    
    if (!clubInfo || !clubInfo.registeredBy) return [];
    
    return [clubInfo.registeredBy];
  }

  async createMatchResultEmbed(clubId, match) {
    const clubName = this.apiClient.getClubName(clubId);
    const matchTime = new Date(match.date * 1000);
    
    const isHome = match.home_club == clubId;
    const opponentId = isHome ? match.away_club : match.home_club;
    const opponentName = this.apiClient.getClubName(opponentId);
    const venue = isHome ? '🏟️ Domicile' : '✈️ Extérieur';
    
    const clubGoals = isHome ? match.home_goals : match.away_goals;
    const opponentGoals = isHome ? match.away_goals : match.home_goals;
    
    let matchResult = '';
    let embedColor = '';
    let resultEmoji = '';
    
    if (clubGoals > opponentGoals) {
      matchResult = '🎉 **VICTOIRE !**';
      embedColor = '#4CAF50';
      resultEmoji = '🟢';
    } else if (clubGoals < opponentGoals) {
      matchResult = '😔 **Défaite**';
      embedColor = '#F44336';
      resultEmoji = '🔴';
    } else {
      matchResult = '🤝 **Match Nul**';
      embedColor = '#FF9800';
      resultEmoji = '🟡';
    }
    
    const finalScore = `${match.home_goals} - ${match.away_goals}`;
    
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
    
    if (match.attendance) {
      embed.addFields({
        name: '👥 Affluence',
        value: `${match.attendance.toLocaleString()} spectateurs`,
        inline: true
      });
    }
    
    embed.addFields({
      name: '🔗 Actions',
      value: `[Voir le club sur Soccerverse](https://play.soccerverse.com/club/${clubId})`,
      inline: false
    });
    
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
    
    logger.debug(`🧹 Nettoyage matchs: ${this.processedMatches.size} restants`);
  }

  getResultStats() {
    return {
      processedMatchesCount: this.processedMatches.size,
      checkInterval: this.checkInterval / 60000,
      resultDelay: this.resultDelay / 60000,
      notificationDelay: this.notificationDelay / 1000,
      method: 'Vérification cyclique toutes les 3 minutes'
    };
  }

  async forceCheckResults() {
    logger.info('🔄 Vérification forcée résultats...');
    await this.checkRecentMatches();
  }

  resetResultCache() {
    this.processedMatches.clear();
    logger.info('🔄 Cache résultats réinitialisé');
  }

  debugProcessedMatches() {
    logger.debug('=== MATCHS TRAITÉS DEBUG ===');
    for (const [key, matchData] of this.processedMatches.entries()) {
      const timeAgo = Math.round((Date.now() - matchData.timestamp) / 60000);
      logger.debug(`${key}: il y a ${timeAgo}min - Club ${matchData.clubId}`);
    }
    logger.debug('=== FIN DEBUG MATCHS ===');
  }
}

module.exports = MatchResultWatcher;
