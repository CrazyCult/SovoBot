const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../utils/logger');

class MatchNotificationWatcher {
  constructor(client, dataManager, apiClient) {
    this.client = client;
    this.dataManager = dataManager;
    this.apiClient = apiClient;
    
    // Cache des notifications envoyées (pour éviter les doublons)
    this.sentNotifications = new Map();
    
    // Intervalle de vérification (30 minutes)
    this.checkInterval = 30 * 60 * 1000;
    
    // Délais avant le match pour les notifications (en minutes)
    this.notificationTimes = [360, 180, 60]; // 6h, 3h, 1h
    
    // Deadline = 2h avant le match
    this.deadlineBeforeMatch = 120; // minutes
    
    // Statistiques
    this.stats = {
      totalChecks: 0,
      notificationsSent: 0,
      matchesChecked: 0
    };
    
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
    
    logger.info('⚽ Service de notifications de match démarré (vérification toutes les 30 minutes)');
  }

  async checkAllUpcomingMatches() {
    try {
      const allClubs = this.getAllRegisteredClubs();
      
      if (allClubs.length === 0) {
        return;
      }
      
      logger.debug(`⚽ Vérification des matchs à venir pour ${allClubs.length} club(s)`);
      this.stats.totalChecks++;
      
      for (const { clubId, channels } of allClubs) {
        try {
          await this.checkClubUpcomingMatch(clubId, channels);
          this.stats.matchesChecked++;
          
          // Attendre 2 secondes entre chaque club
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          logger.error(`Erreur vérification match club ${clubId}:`, error);
        }
      }
      
      // Nettoyer les vieilles notifications
      this.cleanupOldNotifications();
      
    } catch (error) {
      logger.error('Erreur vérification globale des matchs:', error);
    }
  }

  async checkClubUpcomingMatch(clubId, channels) {
    try {
      // Récupérer le prochain match du club
      const nextMatch = await this.apiClient.getClubNextMatch(clubId);
      
      if (!nextMatch) {
        logger.debug(`Pas de prochain match pour le club ${clubId}`);
        return;
      }

      const matchTime = new Date(nextMatch.date * 1000);
      const now = new Date();
      const minutesUntilMatch = Math.floor((matchTime - now) / (60 * 1000));

      // La deadline est 2h avant le match
      const deadlineTime = new Date(matchTime.getTime() - (this.deadlineBeforeMatch * 60 * 1000));
      const minutesUntilDeadline = Math.floor((deadlineTime - now) / (60 * 1000));

      logger.debug(`Club ${clubId}: Match dans ${minutesUntilMatch}min, deadline dans ${minutesUntilDeadline}min`);

      // Vérifier si la composition a déjà été marquée comme complétée
      const compositionCompleted = this.dataManager.isCompositionCompleted(clubId, nextMatch.date);

      if (compositionCompleted) {
        logger.debug(`⏭️ Composition déjà complétée pour Club ${clubId}, match ${nextMatch.date} - pas de notification`);
        return;
      }

      // Vérifier si on doit envoyer une notification
      for (const notifyMinutes of this.notificationTimes) {
        const notificationKey = `${clubId}_${nextMatch.date}_${notifyMinutes}`;

        // Vérifier si on est dans la fenêtre de notification
        const minWindow = notifyMinutes - 15; // -15 minutes de marge
        const maxWindow = notifyMinutes + 15; // +15 minutes de marge

        const isInTimeWindow = minutesUntilDeadline >= minWindow && minutesUntilDeadline <= maxWindow;

        if (isInTimeWindow && !this.sentNotifications.has(notificationKey)) {
          await this.sendMatchReminderNotification(clubId, nextMatch, notifyMinutes, channels);
          this.sentNotifications.set(notificationKey, Date.now());
          this.stats.notificationsSent++;

          logger.info(`⚽ Notification envoyée: Club ${clubId}, ${notifyMinutes}min avant deadline`);
        }
      }
      
    } catch (error) {
      logger.error(`Erreur récupération match club ${clubId}:`, error);
    }
  }

  async sendMatchReminderNotification(clubId, match, minutesBeforeDeadline, channels) {
    try {
      const clubName = this.apiClient.getClubName(clubId);
      const matchTime = new Date(match.date * 1000);
      const deadlineTime = new Date(matchTime.getTime() - (this.deadlineBeforeMatch * 60 * 1000));
      
      const isHome = match.home_club == clubId;
      const opponentName = isHome ? match.away_club_name : match.home_club_name;
      const venue = isHome ? '🏟️ Domicile' : '✈️ Extérieur';
      
      // Déterminer l'urgence
      let urgencyColor = '#4CAF50';
      let urgencyEmoji = '⏰';
      let urgencyText = 'Rappel';
      
      if (minutesBeforeDeadline <= 60) {
        urgencyColor = '#FF6B6B';
        urgencyEmoji = '🚨';
        urgencyText = 'URGENT';
      } else if (minutesBeforeDeadline <= 180) {
        urgencyColor = '#FF9800';
        urgencyEmoji = '⚠️';
        urgencyText = 'Attention';
      }
      
      const embed = new EmbedBuilder()
        .setColor(urgencyColor)
        .setTitle(`${urgencyEmoji} ${urgencyText} - Composition d'équipe`)
        .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`)
        .setDescription(`**${clubName}** a un match qui approche !`)
        .addFields(
          {
            name: '🆚 Adversaire',
            value: opponentName,
            inline: true
          },
          {
            name: '📍 Lieu',
            value: venue,
            inline: true
          },
          {
            name: '🏆 Compétition',
            value: match.competition_type || '⚽ Match',
            inline: true
          },
          {
            name: '⏰ Deadline Composition',
            value: `<t:${Math.floor(deadlineTime.getTime() / 1000)}:R>`,
            inline: true
          },
          {
            name: '⚽ Début du Match',
            value: `<t:${Math.floor(matchTime.getTime() / 1000)}:F>`,
            inline: true
          },
          {
            name: '🏟️ Stade',
            value: match.stadium_name || 'Stade inconnu',
            inline: true
          }
        )
        .setFooter({ 
          text: `${minutesBeforeDeadline >= 60 ? Math.floor(minutesBeforeDeadline / 60) + 'h' : minutesBeforeDeadline + 'min'} avant la deadline • Soccerverse Bot v3.0` 
        })
        .setTimestamp();

      // Ajouter un message contextuel selon l'urgence
      let contextMessage = '';
      if (minutesBeforeDeadline <= 60) {
        contextMessage = '🚨 **DERNIÈRE HEURE !** N\'oubliez pas de définir votre composition !';
      } else if (minutesBeforeDeadline <= 180) {
        contextMessage = '⚠️ Plus que quelques heures pour préparer votre équipe.';
      } else {
        contextMessage = '💡 Pensez à préparer votre composition pour ce match.';
      }
      
      embed.addFields({
        name: '📝 Action requise',
        value: contextMessage + `\n\n[Définir la composition](https://play.soccerverse.com/club/${clubId})`,
        inline: false
      });

      // Créer le bouton "Composition faite"
      const compositionDoneButton = new ButtonBuilder()
        .setCustomId(`composition_done_${clubId}_${match.date}`)
        .setLabel('✅ Composition faite')
        .setStyle(ButtonStyle.Success);

      const actionRow = new ActionRowBuilder()
        .addComponents(compositionDoneButton);

      // Envoyer dans tous les canaux concernés
      for (const channelId of channels) {
        try {
          const channel = this.client.channels.cache.get(channelId);
          if (!channel) {
            logger.warn(`Canal ${channelId} introuvable pour notification match`);
            continue;
          }

          // Récupérer les utilisateurs à mentionner
          const mentionIds = this.getMentionIdsForClub(channelId, clubId);
          const mentions = mentionIds.length > 0 ? mentionIds.map(id => `<@${id}>`).join(' ') : undefined;

          await channel.send({
            content: mentions, // 🔔 Mentions qui déclenchent les notifications
            embeds: [embed],
            components: [actionRow]
          });

          logger.info(`⚽ Notification composition envoyée: ${clubName} (${minutesBeforeDeadline}min) → Canal ${channelId}`);

        } catch (error) {
          logger.error(`Erreur envoi notification dans canal ${channelId}:`, error);
        }
      }
      
    } catch (error) {
      logger.error('Erreur envoi notification composition:', error);
    }
  }

  getMentionIdsForClub(channelId, clubId) {
    // Récupérer l'utilisateur qui a inscrit ce club dans ce canal
    const clubIdStr = clubId.toString();
    const channelClubs = this.dataManager.data.registrations.get(channelId);
    
    if (!channelClubs) return [];
    
    const clubInfo = channelClubs.get(clubIdStr);
    
    if (!clubInfo || !clubInfo.registeredBy) return [];
    
    return [clubInfo.registeredBy];
  }

  getAllRegisteredClubs() {
    const clubMap = new Map();
    
    // CORRECTION: Utiliser registrations au lieu de channels
    for (const [channelId, clubsMap] of this.dataManager.data.registrations.entries()) {
      if (clubsMap && clubsMap.size > 0) {
        for (const [clubId, clubInfo] of clubsMap.entries()) {
          const clubIdNum = parseInt(clubId);
          if (!clubMap.has(clubIdNum)) {
            clubMap.set(clubIdNum, []);
          }
          clubMap.get(clubIdNum).push(channelId);
        }
      }
    }
    
    return Array.from(clubMap.entries()).map(([clubId, channels]) => ({
      clubId,
      channels: [...new Set(channels)]
    }));
  }

  // Méthode pour forcer une vérification (pour debug)
  async forceCheck() {
    logger.info('🔄 Vérification forcée des notifications de match...');
    await this.checkAllUpcomingMatches();
  }

  // Réinitialiser le cache des notifications (pour debug)
  resetNotificationCache() {
    this.sentNotifications.clear();
    logger.info('🔄 Cache des notifications réinitialisé');
  }

  // Obtenir les statistiques
  getNotificationStats() {
    return {
      ...this.stats,
      checkInterval: this.checkInterval / 60000, // en minutes
      notificationTimes: this.notificationTimes.map(m => `${m >= 60 ? (m/60) + 'h' : m + 'min'}`).join(', '),
      deadlineBeforeMatch: `${this.deadlineBeforeMatch}min`,
      sentNotificationsCount: this.sentNotifications.size
    };
  }

  // Nettoyer les notifications anciennes du cache
  cleanupOldNotifications() {
    // Garder seulement les notifications des 7 derniers jours
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    let cleanedCount = 0;

    for (const [notifKey, timestamp] of this.sentNotifications.entries()) {
      if (timestamp < sevenDaysAgo) {
        this.sentNotifications.delete(notifKey);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`🧹 Cache notifications nettoyé: ${cleanedCount} entrées supprimées`);
    }

    // Nettoyer aussi les compositions complétées anciennes
    const compositionsCleanedCount = this.dataManager.cleanupOldCompositions();
    if (compositionsCleanedCount > 0) {
      this.dataManager.save();
    }
  }

  // Debug
  debugNotificationWatching() {
    logger.debug('=== NOTIFICATIONS MATCH DEBUG ===');
    const allClubs = this.getAllRegisteredClubs();
    
    if (allClubs.length === 0) {
      logger.debug('Aucun club surveillé');
    } else {
      for (const { clubId, channels } of allClubs) {
        const clubName = this.apiClient.getClubName(clubId);
        logger.debug(`Club ${clubId} (${clubName}): ${channels.length} canal(aux)`);
      }
    }
    
    logger.debug(`Notifications envoyées (cache): ${this.sentNotifications.size}`);
    logger.debug(`Statistiques: ${JSON.stringify(this.stats, null, 2)}`);
    logger.debug('=== FIN DEBUG NOTIFICATIONS ===');
  }
}

module.exports = MatchNotificationWatcher;
