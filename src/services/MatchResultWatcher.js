const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

class MatchResultWatcher {
  constructor(client, dataManager, apiClient) {
    this.client = client;
    this.dataManager = dataManager;
    this.apiClient = apiClient;
    
    // 🔥 CORRECTION: Charger depuis le bon emplacement
    this.processedMatches = this.loadProcessedMatches();
    
    this.checkInterval = 30 * 1000;
    this.firstAttemptDelay = 15 * 1000;
    this.retryDelay = 30 * 1000;
    this.maxRetries = 3;
    this.matchAttempts = new Map();
    this.notificationDelay = 10 * 1000;
    
    // 🔥 NOUVEAU: Sauvegarder toutes les 5 minutes
    setInterval(() => {
      this.saveProcessedMatches();
    }, 5 * 60 * 1000);
    
    this.startWatching();
  }

  // 🔥 CORRECTION MAJEURE: Meilleure persistance
  loadProcessedMatches() {
    try {
      const settings = this.dataManager.getChannelSettings('_global_results');
      
      if (settings && settings.processedMatches) {
        const map = new Map();
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000); // 🔥 7 jours au lieu de 1
        
        // Charger tous les matchs récents
        for (const [key, data] of Object.entries(settings.processedMatches)) {
          if (data.timestamp > sevenDaysAgo) {
            map.set(key, data);
          }
        }
        
        logger.info(`📦 ${map.size} match(s) déjà traité(s) chargé(s) depuis le cache (7 derniers jours)`);
        return map;
      }
    } catch (error) {
      logger.warn('⚠️ Impossible de charger le cache des matchs:', error.message);
    }
    
    return new Map();
  }

  // 🔥 CORRECTION: Sauvegarder de manière robuste
  async saveProcessedMatches() {
    try {
      // Convertir Map en objet pour JSON
      const processedMatchesObj = {};
      for (const [key, data] of this.processedMatches.entries()) {
        processedMatchesObj[key] = data;
      }
      
      // Sauvegarder dans un canal spécial pour les résultats
      this.dataManager.setChannelSettings('_global_results', {
        processedMatches: processedMatchesObj,
        lastSaved: Date.now()
      });
      
      await this.dataManager.save();
      
      logger.debug(`💾 Cache matchs sauvegardé: ${this.processedMatches.size} entrée(s)`);
    } catch (error) {
      logger.error('❌ Erreur lors de la sauvegarde du cache:', error);
    }
  }

  startWatching() {
    setTimeout(() => {
      this.checkRecentMatches();
    }, 30000);
    
    setInterval(() => {
      this.checkRecentMatches();
    }, this.checkInterval);
    
    logger.info('⚽ Surveillance résultats démarrée (30s, premier essai 15s après match, 3 tentatives espacées de 30s)');
  }

  async checkRecentMatches() {
    try {
      const registeredClubs = this.dataManager.getAllRegisteredClubs();
      
      if (registeredClubs.length === 0) {
        return;
      }
      
      logger.debug(`⚽ Vérification résultats pour ${registeredClubs.length} club(s)`);
      
      const clubsToCheck = [];

      for (const clubId of registeredClubs) {
        const clubIdNum = parseInt(clubId);

        // Ignorer les IDs invalides
        if (isNaN(clubIdNum) || clubIdNum <= 0) {
          logger.warn(`⚠️ ID de club invalide ignoré dans MatchResultWatcher: "${clubId}"`);
          continue;
        }

        clubsToCheck.push({
          clubId: clubIdNum,
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
      
      // 🔥 CORRECTION CRITIQUE: Générer une clé robuste
      const matchKey = this.generateMatchKey(clubId, lastMatch);
      
      // 🔥 VÉRIFICATION IMMÉDIATE: Si déjà traité, STOP !
      if (this.processedMatches.has(matchKey)) {
        logger.debug(`✅ Match ${matchKey} déjà notifié, skip`);
        return;
      }
      
      const matchTime = new Date(lastMatch.date * 1000);
      const now = new Date();
      const timeSinceMatch = now.getTime() - matchTime.getTime();
      const minDelay = this.firstAttemptDelay;
      const maxDelay = 2 * 60 * 1000;
      
      if (timeSinceMatch < minDelay) {
        return;
      }
      
      const attemptData = this.matchAttempts.get(matchKey) || { attempts: 0, lastAttempt: 0 };
      
      if (attemptData.attempts >= this.maxRetries) {
        if (lastMatch.played === 1) {
          await this.processMatchResult(clubId, lastMatch, matchKey);
        } else {
          if (timeSinceMatch > maxDelay && timeSinceMatch < 6 * 60 * 60 * 1000) {
            const lastCheckTime = attemptData.lastAttempt;
            const timeSinceLastCheck = Date.now() - lastCheckTime;
            
            if (timeSinceLastCheck >= 3 * 60 * 1000) {
              if (lastMatch.played === 1) {
                await this.processMatchResult(clubId, lastMatch, matchKey);
              } else {
                this.matchAttempts.set(matchKey, {
                  ...attemptData,
                  lastAttempt: Date.now()
                });
              }
            }
          }
        }
        return;
      }
      
      const timeSinceLastAttempt = Date.now() - attemptData.lastAttempt;
      if (attemptData.attempts > 0 && timeSinceLastAttempt < this.retryDelay) {
        return;
      }
      
      this.matchAttempts.set(matchKey, {
        attempts: attemptData.attempts + 1,
        lastAttempt: Date.now()
      });
      
      logger.debug(`Tentative ${attemptData.attempts + 1}/${this.maxRetries} pour match ${matchKey} (${Math.round(timeSinceMatch/1000)}s après match)`);
      
      if (lastMatch.played === 1) {
        logger.info(`✅ Match terminé détecté à la tentative ${attemptData.attempts + 1}: ${matchKey}, Score ${lastMatch.home_goals}-${lastMatch.away_goals}`);
        await this.processMatchResult(clubId, lastMatch, matchKey);
      } else {
        logger.debug(`❌ Match ${matchKey} pas encore terminé (played=${lastMatch.played}, tentative ${attemptData.attempts + 1}/${this.maxRetries})`);
      }
      
    } catch (error) {
      if (error.message.includes('429') || error.message.includes('timeout')) {
        logger.warn(`Rate limit/timeout club ${clubId}, skip`);
      } else {
        logger.error(`Erreur vérification club ${clubId}:`, error);
      }
    }
  }

  // 🔥 NOUVELLE MÉTHODE: Générer une clé unique et robuste
  generateMatchKey(clubId, match) {
    // Essayer plusieurs sources d'ID dans l'ordre de préférence
    const matchId = match.fixture_id || match.match_id || match.id;
    
    if (matchId) {
      return `${clubId}_${matchId}`;
    }
    
    // Fallback: utiliser la date + équipes
    const dateKey = Math.floor(match.date / 60); // Arrondir à la minute
    const homeClub = match.home_club || 0;
    const awayClub = match.away_club || 0;
    
    return `${clubId}_${dateKey}_${homeClub}_${awayClub}`;
  }

  async processMatchResult(clubId, lastMatch, matchKey) {
    // 🔥 DOUBLE VÉRIFICATION
    if (this.processedMatches.has(matchKey)) {
      logger.warn(`⚠️ Match ${matchKey} déjà dans le cache, skip (double vérification)`);
      return;
    }
    
    logger.info(`🏆 AJOUT match au cache: ${matchKey} (Club ${clubId}, Score ${lastMatch.home_goals}-${lastMatch.away_goals})`);
    
    this.processedMatches.set(matchKey, {
      timestamp: Date.now(),
      clubId: clubId,
      matchData: {
        date: lastMatch.date,
        home_club: lastMatch.home_club,
        away_club: lastMatch.away_club,
        home_goals: lastMatch.home_goals,
        away_goals: lastMatch.away_goals
      }
    });
    
    this.matchAttempts.delete(matchKey);
    
    // 🔥 NOUVEAU: Sauvegarder immédiatement après traitement
    await this.saveProcessedMatches();
    
    logger.info(`🏆 Résultat notifié: Club ${clubId}, Score ${lastMatch.home_goals}-${lastMatch.away_goals}`);
    
    await this.sendMatchResultNotification(clubId, lastMatch);
  }

  async sendMatchResultNotification(clubId, match) {
    try {
      const channelsForClub = this.dataManager.getChannelsForClub(clubId);
      
      if (channelsForClub.length === 0) {
        return;
      }
      
      // Récupérer les stats détaillées du match
      const matchDetails = await this.getMatchDetails(match.fixture_id || match.match_id || match.id);
      const embed = await this.createMatchResultEmbed(clubId, match, matchDetails);
      
      for (const channelId of channelsForClub) {
        try {
          const channel = this.client.channels.cache.get(channelId);
          if (!channel) {
            logger.warn(`Canal ${channelId} introuvable`);
            continue;
          }
          
          const mentionIds = this.getMentionIdsForClub(channelId, clubId);
          const mentions = mentionIds.length > 0 ? mentionIds.map(id => `<@${id}>`).join(' ') : undefined;
          
          await channel.send({ 
            content: mentions,
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

  async getMatchDetails(fixtureId) {
    if (!fixtureId) {
      logger.warn('Aucun fixture_id fourni, skip détails');
      return null;
    }
    
    try {
      const result = await this.apiClient.makeRpcRequest('get_fixture', {
        fixture_id: parseInt(fixtureId)
      });
      
      let matchDetails = null;
      
      if (Array.isArray(result)) {
        matchDetails = result[0];
      } else if (result && result.data && Array.isArray(result.data)) {
        matchDetails = result.data[0];
      } else if (result && result.data) {
        matchDetails = result.data;
      } else if (result) {
        matchDetails = result;
      }
      
      if (!matchDetails) {
        logger.warn(`Aucun détail trouvé pour le match ${fixtureId}`);
        return null;
      }
      
      logger.debug(`✅ Stats match ${fixtureId}: possession=${matchDetails.home_possession}/${matchDetails.away_possession}, tirs=${matchDetails.home_shots}/${matchDetails.away_shots}`);
      
      return matchDetails;
    } catch (error) {
      logger.warn(`Impossible de récupérer les détails du match ${fixtureId}:`, error.message);
      return null;
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

  async createMatchResultEmbed(clubId, match, matchDetails) {
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
      .setDescription(`${matchResult}\n${resultEmoji} **${finalScore}**`);

    // Infos du match
    let matchInfo = `**${homeTeam}** ${match.home_goals} - ${match.away_goals} **${awayTeam}**\n`;
    matchInfo += `📍 ${venue}\n`;
    matchInfo += `🏟️ ${match.stadium_name || 'Stade inconnu'}\n`;
    matchInfo += `📅 ${matchTime.toLocaleDateString('fr-FR')} à ${matchTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}\n`;
    matchInfo += `🏆 ${match.competition_type || '⚽ Match'}`;
    
    embed.addFields({
      name: '🏟️ Match',
      value: matchInfo,
      inline: false
    });

    const hasStats = matchDetails && (
      matchDetails.home_possession !== undefined ||
      matchDetails.home_shots !== undefined ||
      matchDetails.home_corners !== undefined
    );

    if (hasStats) {
      const clubStats = isHome ? {
        possession: matchDetails.home_possession,
        shots: matchDetails.home_shots,
        shotsOnTarget: matchDetails.home_shots_on_target,
        corners: matchDetails.home_corners
      } : {
        possession: matchDetails.away_possession,
        shots: matchDetails.away_shots,
        shotsOnTarget: matchDetails.away_shots_on_target,
        corners: matchDetails.away_corners
      };
      
      const opponentStats = isHome ? {
        possession: matchDetails.away_possession,
        shots: matchDetails.away_shots,
        shotsOnTarget: matchDetails.away_shots_on_target,
        corners: matchDetails.away_corners
      } : {
        possession: matchDetails.home_possession,
        shots: matchDetails.home_shots,
        shotsOnTarget: matchDetails.home_shots_on_target,
        corners: matchDetails.home_corners
      };

      let clubStatsText = `**${clubName}**\n`;
      clubStatsText += `⚽ **Buts:** ${clubGoals}\n`;
      clubStatsText += `📊 **Possession:** ${clubStats.possession || 'N/A'}%\n`;
      clubStatsText += `🎯 **Tirs:** ${clubStats.shots || 0} (${clubStats.shotsOnTarget || 0} cadrés)\n`;
      clubStatsText += `🚩 **Corners:** ${clubStats.corners || 0}`;
      
      embed.addFields({
        name: '📊 Vos Statistiques',
        value: clubStatsText,
        inline: true
      });

      let opponentStatsText = `**${opponentName}**\n`;
      opponentStatsText += `⚽ **Buts:** ${opponentGoals}\n`;
      opponentStatsText += `📊 **Possession:** ${opponentStats.possession || 'N/A'}%\n`;
      opponentStatsText += `🎯 **Tirs:** ${opponentStats.shots || 0} (${opponentStats.shotsOnTarget || 0} cadrés)\n`;
      opponentStatsText += `🚩 **Corners:** ${opponentStats.corners || 0}`;
      
      embed.addFields({
        name: '🆚 Adversaire',
        value: opponentStatsText,
        inline: true
      });

      if (matchDetails.man_of_match) {
        const motmName = this.apiClient.getPlayerName(matchDetails.man_of_match);
        embed.addFields({
          name: '⭐ Homme du Match',
          value: motmName,
          inline: false
        });
      }

      if (matchDetails.attendance) {
        embed.addFields({
          name: '👥 Affluence',
          value: `${matchDetails.attendance.toLocaleString()} spectateurs`,
          inline: true
        });
      }
    } else {
      embed.addFields(
        {
          name: '📊 Performance',
          value: `**${clubName}**\n⚽ Buts marqués: ${clubGoals}\n🥅 Buts encaissés: ${opponentGoals}\n📍 ${venue}`,
          inline: true
        },
        {
          name: '🆚 Adversaire',
          value: `**${opponentName}**\n⚽ Buts marqués: ${opponentGoals}\n🥅 Buts encaissés: ${clubGoals}\n👤 ${isHome ? match.away_manager : match.home_manager || 'Inconnu'}`,
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
    // 🔥 CORRECTION: 7 jours au lieu de 24h
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    let cleanedCount = 0;
    
    for (const [key, matchData] of this.processedMatches.entries()) {
      if (matchData.timestamp < sevenDaysAgo) {
        this.processedMatches.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      this.saveProcessedMatches().catch(err => {
        logger.error('Erreur sauvegarde après nettoyage:', err);
      });
      logger.info(`🧹 Cache nettoyé: ${cleanedCount} match(s) ancien(s) supprimé(s) (>7 jours)`);
    }
    
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [key, attemptData] of this.matchAttempts.entries()) {
      if (attemptData.lastAttempt < oneHourAgo) {
        this.matchAttempts.delete(key);
      }
    }
    
    logger.debug(`🧹 Nettoyage: ${this.processedMatches.size} matchs traités, ${this.matchAttempts.size} matchs en cours`);
  }

  getResultStats() {
    return {
      processedMatchesCount: this.processedMatches.size,
      pendingMatchesCount: this.matchAttempts.size,
      checkInterval: this.checkInterval / 1000,
      firstAttemptDelay: this.firstAttemptDelay / 1000,
      retryDelay: this.retryDelay / 1000,
      maxRetries: this.maxRetries,
      notificationDelay: this.notificationDelay / 1000,
      method: 'Vérification toutes les 30s, 1er essai 15s après match, 3 tentatives espacées de 30s'
    };
  }

  async forceCheckResults() {
    logger.info('🔄 Vérification forcée résultats...');
    await this.checkRecentMatches();
  }

  resetResultCache() {
    this.processedMatches.clear();
    this.matchAttempts.clear();
    
    this.saveProcessedMatches().catch(err => {
      logger.error('Erreur sauvegarde après reset:', err);
    });
    
    logger.info('🔄 Cache résultats et tentatives réinitialisés');
  }

  debugProcessedMatches() {
    logger.debug('=== MATCHS TRAITÉS DEBUG ===');
    logger.debug(`Matchs notifiés: ${this.processedMatches.size}`);
    for (const [key, matchData] of this.processedMatches.entries()) {
      const timeAgo = Math.round((Date.now() - matchData.timestamp) / 60000);
      logger.debug(`  ${key}: il y a ${timeAgo}min - Club ${matchData.clubId}`);
    }
    
    logger.debug(`\nMatchs en attente: ${this.matchAttempts.size}`);
    for (const [key, attemptData] of this.matchAttempts.entries()) {
      const timeAgo = Math.round((Date.now() - attemptData.lastAttempt) / 1000);
      logger.debug(`  ${key}: ${attemptData.attempts}/${this.maxRetries} tentatives, dernière il y a ${timeAgo}s`);
    }
    logger.debug('=== FIN DEBUG MATCHS ===');
  }
}

module.exports = MatchResultWatcher;
