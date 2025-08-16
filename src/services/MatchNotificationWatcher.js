const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

class MatchNotificationWatcher {
  constructor(client, dataManager, apiClient) {
    this.client = client;
    this.dataManager = dataManager;
    this.apiClient = apiClient;
    
    // Cache des notifications déjà envoyées pour éviter les doublons
    // Format: `${clubId}_${matchId}_${notificationType}` -> timestamp
    this.sentNotifications = new Map();
    
    // Intervalle de vérification (30 minutes)
    this.checkInterval = 30 * 60 * 1000;
    
    // Horaires de notification (en heures avant la deadline de compo)
    this.notificationTimes = [6, 3, 1]; // 6h, 3h, 1h avant deadline
    
    // Démarrer la surveillance
    this.startWatching();
  }

  startWatching() {
    // Vérification initiale après 1 minute
    setTimeout(() => {
      this.checkAllUpcomingMatches();
    }, 60000);
    
    // Puis vérification toutes les 30 minutes
    setInterval(() => {
      this.checkAllUpcomingMatches();
    }, this.checkInterval);
    
    logger.info('🕐 Surveillance des notifications de match démarrée (vérification toutes les 30 minutes)');
  }

  async checkAllUpcomingMatches() {
    try {
      // Récupérer tous les clubs inscrits
      const registeredClubs = this.dataManager.getAllRegisteredClubs();
      
      if (registeredClubs.length === 0) {
        return;
      }
      
      logger.debug(`🕐 Vérification notifications pour ${registeredClubs.length} club(s) inscrit(s)`);
      
      for (const clubId of registeredClubs) {
        try {
          await this.checkClubUpcomingMatch(parseInt(clubId));
          // Attendre 2 secondes entre chaque vérification pour éviter de surcharger l'API
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          logger.error(`Erreur vérification club ${clubId}:`, error);
        }
      }
      
      // Nettoyer les anciennes notifications (plus de 7 jours)
      this.cleanupOldNotifications();
      
    } catch (error) {
      logger.error('Erreur surveillance notifications globale:', error);
    }
  }

  async checkClubUpcomingMatch(clubId) {
    try {
      // Récupérer le prochain match du club
      const nextMatch = await this.apiClient.getClubNextMatch(clubId);
      
      if (!nextMatch) {
        return; // Pas de prochain match
      }
      
      const matchTime = new Date(nextMatch.date * 1000);
      const now = new Date();
      
      // Calcul de la deadline (2h avant le match)
      const deadlineTime = new Date(matchTime.getTime() - (2 * 60 * 60 * 1000));
      
      // Vérifier si le match est dans les 24 prochaines heures
      const timeDiffHours = (matchTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (timeDiffHours > 24 || timeDiffHours < 0) {
        return; // Match trop loin ou déjà passé
      }
      
      // Vérifier chaque moment de notification
      for (const hoursBeforeDeadline of this.notificationTimes) {
        const notificationTime = new Date(deadlineTime.getTime() - (hoursBeforeDeadline * 60 * 60 * 1000));
        const timeUntilNotification = notificationTime.getTime() - now.getTime();
        
        // Si c'est le moment d'envoyer la notification (dans les 30 minutes)
        if (timeUntilNotification <= this.checkInterval && timeUntilNotification >= 0) {
          await this.sendMatchNotification(clubId, nextMatch, hoursBeforeDeadline, deadlineTime);
        }
      }
      
    } catch (error) {
      logger.error(`Erreur vérification match club ${clubId}:`, error);
    }
  }

  async sendMatchNotification(clubId, match, hoursBeforeDeadline, deadlineTime) {
    try {
      // Générer une clé unique pour éviter les doublons
      const notificationKey = `${clubId}_${match.fixture_id || match.date}_${hoursBeforeDeadline}h`;
      
      // Vérifier si cette notification a déjà été envoyée
      if (this.sentNotifications.has(notificationKey)) {
        return;
      }
      
      // Marquer comme envoyée
      this.sentNotifications.set(notificationKey, Date.now());
      
      // Récupérer tous les canaux où ce club est inscrit
      const channelsForClub = this.dataManager.getChannelsForClub(clubId);
      
      if (channelsForClub.length === 0) {
        return;
      }
      
      // Récupérer les infos du club
      let clubName = this.apiClient.getClubName(clubId);
      
      // Créer l'embed de notification
      const embed = await this.createMatchNotificationEmbed(clubId, match, hoursBeforeDeadline, deadlineTime);
      
      // Envoyer la notification dans chaque canal
      for (const channelId of channelsForClub) {
        try {
          const channel = this.client.channels.cache.get(channelId);
          if (!channel) {
            logger.warn(`Canal ${channelId} introuvable pour notification match`);
            continue;
          }
          
          await channel.send({ embeds: [embed] });
          
        } catch (error) {
          logger.error(`Erreur envoi notification canal ${channelId}:`, error);
        }
      }
      
      logger.info(`⚽ Notification match envoyée: Club ${clubId}, ${hoursBeforeDeadline}h avant deadline, ${channelsForClub.length} canal(aux)`);
      
    } catch (error) {
      logger.error('Erreur envoi notification match:', error);
    }
  }

  async createMatchNotificationEmbed(clubId, match, hoursBeforeDeadline, deadlineTime) {
    const clubName = this.apiClient.getClubName(clubId);
    const matchTime = new Date(match.date * 1000);
    const now = new Date();
    
    // Déterminer l'adversaire
    const isHome = match.home_club == clubId;
    const opponentId = isHome ? match.away_club : match.home_club;
    const opponentName = this.apiClient.getClubName(opponentId);
    const venue = isHome ? '🏟️ Domicile' : '✈️ Extérieur';
    
    // Couleur selon l'urgence
    const colors = {
      6: '#FFA500', // Orange pour 6h
      3: '#FF6B6B', // Rouge clair pour 3h  
      1: '#FF0000'  // Rouge vif pour 1h
    };
    
    // Emojis selon l'urgence
    const urgencyEmojis = {
      6: '⏰',
      3: '⚠️',
      1: '🚨'
    };
    
    const embed = new EmbedBuilder()
      .setColor(colors[hoursBeforeDeadline] || '#FFA500')
      .setTitle(`${urgencyEmojis[hoursBeforeDeadline]} Rappel Composition d'Équipe`)
      .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`)
      .setDescription(`**${clubName}** a un match dans ${Math.round((matchTime.getTime() - now.getTime()) / (1000 * 60 * 60))}h !`)
      .addFields(
        {
          name: '⚽ Match à venir',
          value: `**${clubName}** vs **${opponentName}**\n` +
                 `📍 ${venue}\n` +
                 `🏟️ ${match.stadium_name || 'Stade inconnu'}\n` +
                 `📅 ${matchTime.toLocaleDateString('fr-FR')} à ${matchTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}\n` +
                 `🏆 ${match.competition_type || '⚽ Match'}`,
          inline: false
        },
        {
          name: `${urgencyEmojis[hoursBeforeDeadline]} Deadline Composition`,
          value: `**Plus que ${hoursBeforeDeadline}h avant la deadline !**\n\n` +
                 `🕐 **Deadline:** ${deadlineTime.toLocaleDateString('fr-FR')} à ${deadlineTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}\n` +
                 `⚡ **Temps restant:** ${this.formatTimeRemaining(deadlineTime)}`,
          inline: false
        },
        {
          name: '📝 Action requise',
          value: `🔗 **[Faire la composition sur Soccerverse](https://play.soccerverse.com/club/${clubId})**\n\n` +
                 '• Vérifiez votre formation\n' +
                 '• Définissez votre tactique\n' +
                 '• Sélectionnez vos remplaçants\n' +
                 '• Confirmez votre composition',
          inline: false
        }
      )
      .setFooter({ 
        text: `La composition doit être validée 2h avant le match • Soccerverse Bot v3.0` 
      })
      .setTimestamp();

    return embed;
  }

  formatTimeRemaining(deadline) {
    const now = new Date();
    const timeDiff = deadline.getTime() - now.getTime();
    
    if (timeDiff <= 0) {
      return '⚠️ **DEADLINE DÉPASSÉE**';
    }
    
    const hours = Math.floor(timeDiff / (1000 * 60 * 60));
    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}min`;
    } else {
      return `${minutes}min`;
    }
  }

  cleanupOldNotifications() {
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    for (const [key, timestamp] of this.sentNotifications.entries()) {
      if (timestamp < oneWeekAgo) {
        this.sentNotifications.delete(key);
      }
    }
    
    logger.debug(`🧹 Nettoyage notifications anciennes: ${this.sentNotifications.size} restantes`);
  }

  // Méthodes utilitaires pour les tests et debug
  
  getNotificationStats() {
    return {
      sentNotificationsCount: this.sentNotifications.size,
      checkInterval: this.checkInterval / 60000, // en minutes
      notificationTimes: this.notificationTimes
    };
  }

  // Force une vérification immédiate (pour debug)
  async forceCheck() {
    logger.info('🔄 Vérification forcée des notifications de match...');
    await this.checkAllUpcomingMatches();
  }

  // Réinitialiser le cache des notifications (pour debug)
  resetNotificationCache() {
    this.sentNotifications.clear();
    logger.info('🔄 Cache des notifications réinitialisé');
  }
}

module.exports = MatchNotificationWatcher;
