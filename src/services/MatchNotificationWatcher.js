const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../utils/logger');

class MatchNotificationWatcher {
  constructor(client, dataManager, apiClient, matchResultWatcher) {
    this.client = client;
    this.dataManager = dataManager;
    this.apiClient = apiClient;
    this.matchResultWatcher = matchResultWatcher; // ✅ PARTAGER LE CACHE
    
    // Cache des notifications envoyées (pour éviter les doublons)
    this.sentNotifications = new Map();
    
    // Timers programmés pour chaque notification
    this.scheduledNotifications = new Map(); // notificationKey -> timeoutId
    
    // Délais avant le match pour les notifications (en minutes)
    this.notificationTimes = [360, 180, 60]; // 6h, 3h, 1h
    
    // Deadline = 2h avant le match
    this.deadlineBeforeMatch = 120; // minutes
    
    // Statistiques
    this.stats = {
      totalChecks: 0,
      notificationsSent: 0,
      matchesScheduled: 0
    };
    
    this.startWatching();
  }

  startWatching() {
    // ✅ Programmer les notifications 30 secondes après le démarrage
    setTimeout(() => {
      this.scheduleAllNotifications();
    }, 30000);
    
    // ✅ Re-programmer toutes les 6 heures (au cas où de nouveaux clubs sont inscrits)
    setInterval(() => {
      logger.info('🔄 Reprogrammation périodique des notifications...');
      this.scheduleAllNotifications();
    }, 6 * 60 * 60 * 1000); // 6 heures
    
    logger.info('⚽ Service de notifications de composition démarré (système optimisé avec cache partagé)');
  }

  async scheduleAllNotifications() {
    try {
      // ✅ Annuler toutes les notifications programmées existantes
      for (const timeoutId of this.scheduledNotifications.values()) {
        clearTimeout(timeoutId);
      }
      this.scheduledNotifications.clear();
      
      // ✅ UTILISER LE CACHE DU MatchResultWatcher (même matchs !)
      if (!this.matchResultWatcher || !this.matchResultWatcher.upcomingMatchesCache) {
        logger.warn('⚠️ Cache des matchs non disponible, skip programmation');
        return;
      }
      
      const now = Date.now() / 1000;
      let scheduledCount = 0;
      
      // ✅ Pour chaque club qui a des matchs à venir
      for (const [clubId, matches] of this.matchResultWatcher.upcomingMatchesCache.entries()) {
        // Vérifier que ce club est inscrit quelque part
        const channels = this.dataManager.getChannelsForClub(clubId);
        if (channels.length === 0) {
          continue;
        }
        
        // Pour chaque match du club
        for (const match of matches) {
          // Calculer la deadline (2h avant le match)
          const matchTime = match.date;
          const deadlineTime = matchTime - (this.deadlineBeforeMatch * 60);
          
          // Pour chaque délai de notification (6h, 3h, 1h avant deadline)
          for (const notifyMinutes of this.notificationTimes) {
            const notificationTime = deadlineTime - (notifyMinutes * 60);
            
            // Ne programmer que si c'est dans le futur
            if (notificationTime > now) {
              const notificationKey = `${clubId}_${match.date}_${notifyMinutes}`;
              
              // Skip si déjà envoyée
              if (this.sentNotifications.has(notificationKey)) {
                continue;
              }
              
              // Vérifier si la composition est déjà complétée
              if (this.dataManager.isCompositionCompleted(clubId, match.date)) {
                continue;
              }
              
              // ✅ PROGRAMMER LA NOTIFICATION À L'HEURE EXACTE
              const delayMs = (notificationTime - now) * 1000;
              
              const timeoutId = setTimeout(async () => {
                await this.sendMatchReminderNotification(clubId, match, notifyMinutes, channels);
              }, delayMs);
              
              this.scheduledNotifications.set(notificationKey, timeoutId);
              scheduledCount++;
              
              const notifDate = new Date(notificationTime * 1000);
              logger.debug(`📅 Notification programmée: Club ${clubId} - ${notifyMinutes}min avant deadline → ${notifDate.toLocaleString('fr-FR')}`);
            }
          }
        }
      }
      
      this.stats.matchesScheduled = scheduledCount;
      logger.info(`✅ ${scheduledCount} notification(s) de composition programmée(s)`);
      
    } catch (error) {
      logger.error('❌ Erreur programmation notifications:', error);
    }
  }

  async sendMatchReminderNotification(clubId, match, minutesBeforeDeadline, channels) {
    try {
      const notificationKey = `${clubId}_${match.date}_${minutesBeforeDeadline}`;
      
      // Double-vérification pour éviter les doublons
      if (this.sentNotifications.has(notificationKey)) {
        logger.debug(`⏭️ Notification déjà envoyée: ${notificationKey}`);
        return;
      }
      
      // Vérifier si la composition a été complétée entre-temps
      if (this.dataManager.isCompositionCompleted(clubId, match.date)) {
        logger.debug(`⏭️ Composition déjà complétée pour Club ${clubId}, match ${match.date}`);
        return;
      }
      
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
      
      // Marquer comme envoyée
      this.sentNotifications.set(notificationKey, Date.now());
      this.stats.notificationsSent++;
      
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

  // ✅ MÉTHODE PUBLIQUE: Reprogrammer après ajout d'un club
  async onClubRegistered() {
    logger.info('🔄 Nouveau club inscrit, reprogrammation des notifications...');
    await this.scheduleAllNotifications();
  }

  // Méthode pour forcer une vérification (pour debug)
  async forceCheck() {
    logger.info('🔄 Reprogrammation forcée des notifications...');
    await this.scheduleAllNotifications();
  }

  // Réinitialiser le cache des notifications (pour debug)
  resetNotificationCache() {
    this.sentNotifications.clear();
    logger.info('🔄 Cache des notifications réinitialisé');
    this.scheduleAllNotifications();
  }

  // Obtenir les statistiques
  getNotificationStats() {
    return {
      ...this.stats,
      notificationTimes: this.notificationTimes.map(m => `${m >= 60 ? (m/60) + 'h' : m + 'min'}`).join(', '),
      deadlineBeforeMatch: `${this.deadlineBeforeMatch}min`,
      sentNotificationsCount: this.sentNotifications.size,
      scheduledNotificationsCount: this.scheduledNotifications.size,
      checkInterval: 'Programmation précise (pas de polling)'
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
    logger.debug(`Notifications programmées: ${this.scheduledNotifications.size}`);
    logger.debug(`Notifications envoyées (cache): ${this.sentNotifications.size}`);
    logger.debug(`Statistiques: ${JSON.stringify(this.stats, null, 2)}`);
    logger.debug('=== FIN DEBUG NOTIFICATIONS ===');
  }
}

module.exports = MatchNotificationWatcher;
