const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

class MatchResultWatcher {
  constructor(client, dataManager, apiClient) {
    this.client = client;
    this.dataManager = dataManager;
    this.apiClient = apiClient;
    
    // Cache des matchs en cours pour éviter les doublons
    this.processedMatches = new Map();
    
    // Intervalle de vérification rapide (toutes les 15 secondes)
    this.checkInterval = 15 * 1000;
    
    // Délai après début du match pour récupérer le résultat (1 minute)
    this.resultDelay = 1 * 60 * 1000;
    
    // Map des timers programmés pour éviter les doublons
    this.scheduledChecks = new Map();
    
    this.startWatching();
  }

  startWatching() {
    // Vérification initiale après 30 secondes
    setTimeout(() => {
      this.checkRecentMatches();
    }, 30000);
    
    // Puis vérification toutes les 15 secondes
    setInterval(() => {
      this.checkRecentMatches();
    }, this.checkInterval);
    
    logger.info('⚽ Surveillance des résultats de match démarrée (vérification toutes les 15 secondes)');
  }

  async checkRecentMatches() {
    try {
      const registeredClubs = this.dataManager.getAllRegisteredClubs();
      
      if (registeredClubs.length === 0) {
        return;
      }
      
      logger.debug(`⚽ Vérification résultats récents pour ${registeredClubs.length} club(s)`);
      
      for (const clubId of registeredClubs) {
        try {
          await this.checkClubRecentResult(parseInt(clubId));
          // Attendre 1 seconde entre chaque club
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error(`Erreur vérification club ${clubId}:`, error);
        }
      }
      
      // Nettoyer les anciens matchs du cache
      this.cleanupProcessedMatches();
      
    } catch (error) {
      logger.error('Erreur surveillance résultats globale:', error);
    }
  }

  async checkClubRecentResult(clubId) {
    try {
      // Récupérer le dernier match du club
      const lastMatch = await this.apiClient.getClubLastMatch(clubId);
      
      if (!lastMatch) {
        return;
      }
      
      const matchTime = new Date(lastMatch.date * 1000);
      const now = new Date();
      
      // Vérifier si le match vient de se terminer (entre 1 minute et 2 heures)
      const timeSinceMatchStart = now.getTime() - matchTime.getTime();
      const minDelay = this.resultDelay; // 1 minute
      const maxDelay = 2 * 60 * 60 * 1000; // 2 heures
      
      // Ne traiter que les matchs récents
      if (timeSinceMatchStart < minDelay || timeSinceMatchStart > maxDelay) {
        return;
      }
      
      // Vérifier si le match est terminé
      if (lastMatch.played !== 1) {
        logger.debug(`Match ${lastMatch.date} club ${clubId} pas encore terminé`);
        return;
      }
      
      // Créer une clé unique pour ce match
      const matchKey = `${clubId}_${lastMatch.fixture_id || lastMatch.date}_${lastMatch.home_goals}_${lastMatch.away_goals}`;
      
      // Vérifier si on a déjà envoyé la notification
      if (this.processedMatches.has(matchKey)) {
        return;
      }
      
      // Marquer comme traité
      this.processedMatches.set(matchKey, {
        timestamp: Date.now(),
        clubId: clubId,
        matchData: lastMatch
      });
      
      logger.info(`🏆 Nouveau résultat détecté: Club ${clubId}, Score ${lastMatch.home_goals}-${lastMatch.away_goals}`);
      
      // Envoyer la notification
      await this.sendMatchResultNotification(clubId, lastMatch);
      
    } catch (error) {
      if (error.message.includes('429') || error.message.includes('timeout')) {
        logger.warn(`Rate limit/timeout pour club ${clubId}, ignorer cette fois`);
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
      checkInterval: this.checkInterval / 60000, // en minutes
      resultDelay: this.resultDelay / 60000, // en minutes
      method: 'Vérification cyclique toutes les 3 minutes'
    };
  }

  async forceCheckResults() {
    logger.info('🔄 Vérification forcée des résultats de match...');
    await this.checkRecentMatches();
  }

  resetResultCache() {
    this.processedMatches.clear();
    this.scheduledChecks.clear();
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
