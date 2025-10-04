const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

class MatchNotificationWatcher {
  constructor(client, dataManager, apiClient) {
    this.client = client;
    this.dataManager = dataManager;
    this.apiClient = apiClient;
    
    // Cache des notifications envoyées (pour éviter les doublons)
    this.sentNotifications = new Set();
    
    // Intervalle de vérification (5 minutes)
    this.checkInterval = 5 * 60 * 1000;
    
    // Délai avant match pour envoyer la notification (30 minutes)
    this.notificationWindow = 30 * 60 * 1000;
    
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
    
    // Puis vérification toutes les 5 minutes
    setInterval(() => {
      this.checkAllUpcomingMatches();
    }, this.checkInterval);
    
    logger.info('⚽ Service de notifications de match démarré (vérification toutes les 5 minutes)');
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
        } catch (error) {
          logger.error(`Erreur vérification match club ${clubId}:`, error);
        }
      }
    } catch (error) {
      logger.error('Erreur vérification globale des matchs:', error);
    }
  }

  async checkClubUpcomingMatch(clubId, channels) {
    try {
      // Récupérer le prochain match du club
      const matches = await this.apiClient.getClubMatches(clubId);
      const upcomingMatch = matches.find(m => new Date(m.scheduledAt) > new Date());
      
      if (!upcomingMatch) {
        return;
      }

      const matchTime = new Date(upcomingMatch.scheduledAt);
      const now = new Date();
      const timeUntilMatch = matchTime - now;

      // Vérifier si le match est dans la fenêtre de notification (30 minutes avant)
      if (timeUntilMatch > 0 && timeUntilMatch <= this.notificationWindow) {
        const notificationKey = `${clubId}_${upcomingMatch.id}_lineup`;
        
        // Vérifier si la notification a déjà été envoyée
        if (!this.sentNotifications.has(notificationKey)) {
          // Vérifier si la composition est disponible
          const lineup = await this.apiClient.getMatchLineup(upcomingMatch.id);
          
          if (lineup && lineup.homeTeam && lineup.awayTeam) {
            await this.sendLineupNotification(clubId, upcomingMatch, lineup, channels);
            this.sentNotifications.add(notificationKey);
            this.stats.notificationsSent++;
          } else {
            // Si pas de composition, envoyer au moins une notif de match imminent
            await this.sendMatchImminentNotification(clubId, upcomingMatch, channels);
            this.sentNotifications.add(notificationKey);
            this.stats.notificationsSent++;
          }
        }
      }
    } catch (error) {
      logger.error(`Erreur récupération match club ${clubId}:`, error);
    }
  }

  async sendLineupNotification(clubId, match, lineup, channels) {
    try {
      const club = await this.apiClient.getClub(clubId);
      const isHomeTeam = match.homeClubId === clubId;
      const teamLineup = isHomeTeam ? lineup.homeTeam : lineup.awayTeam;
      const opponentLineup = isHomeTeam ? lineup.awayTeam : lineup.homeTeam;
      
      // Récupérer les infos de l'adversaire
      const opponentId = isHomeTeam ? match.awayClubId : match.homeClubId;
      const opponent = await this.apiClient.getClub(opponentId);

      // Créer l'embed avec la composition
      const embed = new EmbedBuilder()
        .setTitle(`⚽ Composition d'équipe annoncée !`)
        .setDescription(`Le match va bientôt commencer`)
        .addFields(
          { 
            name: `${club.name} ${isHomeTeam ? '(Domicile)' : '(Extérieur)'}`, 
            value: this.formatLineup(teamLineup), 
            inline: false 
          },
          { 
            name: `${opponent.name} ${isHomeTeam ? '(Extérieur)' : '(Domicile)'}`, 
            value: this.formatLineup(opponentLineup), 
            inline: false 
          },
          {
            name: '⏰ Coup d\'envoi',
            value: `<t:${Math.floor(new Date(match.scheduledAt).getTime() / 1000)}:R>`,
            inline: true
          },
          {
            name: '🏟️ Lieu',
            value: isHomeTeam ? 'Domicile' : 'Extérieur',
            inline: true
          }
        )
        .setColor('#4CAF50')
        .setTimestamp();

      if (club.logoUrl) {
        embed.setThumbnail(club.logoUrl);
      }

      // Envoyer dans tous les canaux concernés
      for (const channelId of channels) {
        try {
          const channel = this.client.channels.cache.get(channelId);
          if (!channel) continue;

          // ✅ VRAIE NOTIFICATION avec mentions des utilisateurs inscrits
          const mentionIds = this.getMentionIdsForClub(channelId, clubId);
          const mentions = mentionIds.map(id => `<@${id}>`).join(' ');

          await channel.send({
            content: mentions || undefined, // 🔔 Mentions qui déclenchent les notifications
            embeds: [embed]
          });

          logger.info(`⚽ Notification composition envoyée pour ${club.name} dans le canal ${channelId}`);
        } catch (error) {
          logger.error(`Erreur envoi notification dans canal ${channelId}:`, error);
        }
      }
    } catch (error) {
      logger.error('Erreur envoi notification composition:', error);
    }
  }

  async sendMatchImminentNotification(clubId, match, channels) {
    try {
      const club = await this.apiClient.getClub(clubId);
      const isHomeTeam = match.homeClubId === clubId;
      
      // Récupérer les infos de l'adversaire
      const opponentId = isHomeTeam ? match.awayClubId : match.homeClubId;
      const opponent = await this.apiClient.getClub(opponentId);

      const embed = new EmbedBuilder()
        .setTitle('⚽ Match imminent !')
        .setDescription(`Le match va bientôt commencer`)
        .addFields(
          { 
            name: `${club.name}`, 
            value: isHomeTeam ? '🏠 Domicile' : '✈️ Extérieur',
            inline: true 
          },
          { 
            name: 'VS', 
            value: '⚔️',
            inline: true 
          },
          { 
            name: `${opponent.name}`, 
            value: isHomeTeam ? '✈️ Extérieur' : '🏠 Domicile',
            inline: true 
          },
          {
            name: '⏰ Coup d\'envoi',
            value: `<t:${Math.floor(new Date(match.scheduledAt).getTime() / 1000)}:R>`,
            inline: false
          }
        )
        .setColor('#FFA500')
        .setTimestamp();

      if (club.logoUrl) {
        embed.setThumbnail(club.logoUrl);
      }

      // Envoyer dans tous les canaux concernés
      for (const channelId of channels) {
        try {
          const channel = this.client.channels.cache.get(channelId);
          if (!channel) continue;

          // ✅ VRAIE NOTIFICATION avec mentions
          const mentionIds = this.getMentionIdsForClub(channelId, clubId);
          const mentions = mentionIds.map(id => `<@${id}>`).join(' ');

          await channel.send({
            content: mentions || undefined, // 🔔 Notifications
            embeds: [embed]
          });

          logger.info(`⚽ Notification match imminent envoyée pour ${club.name} dans le canal ${channelId}`);
        } catch (error) {
          logger.error(`Erreur envoi notification dans canal ${channelId}:`, error);
        }
      }
    } catch (error) {
      logger.error('Erreur envoi notification match imminent:', error);
    }
  }

  formatLineup(teamLineup) {
    if (!teamLineup || !teamLineup.starters) {
      return 'Composition non disponible';
    }

    // Formation
    let lineup = '';
    
    if (teamLineup.formation) {
      lineup += `**Formation:** ${teamLineup.formation}\n\n`;
    }

    // Titulaires
    const starters = teamLineup.starters
      .map(p => `${p.firstName} ${p.lastName} (${p.position})`)
      .join('\n');
    
    lineup += `**Titulaires:**\n${starters}`;

    // Remplaçants
    if (teamLineup.substitutes && teamLineup.substitutes.length > 0) {
      const subs = teamLineup.substitutes
        .map(p => `${p.firstName} ${p.lastName} (${p.position})`)
        .join('\n');
      lineup += `\n\n**Remplaçants:**\n${subs}`;
    }
    
    return lineup || 'Aucune composition disponible';
  }

  getMentionIdsForClub(channelId, clubId) {
    // Récupérer les utilisateurs Discord qui ont inscrit ce club dans ce canal
    const channelData = this.dataManager.data.channels[channelId];
    if (!channelData || !channelData.clubs) return [];

    const mentionIds = [];
    for (const [userId, userClubs] of Object.entries(channelData.clubs)) {
      if (userClubs.includes(clubId)) {
        mentionIds.push(userId);
      }
    }
    return mentionIds;
  }

  getAllRegisteredClubs() {
    const clubMap = new Map();
    
    for (const [channelId, channelData] of Object.entries(this.dataManager.data.channels)) {
      if (channelData.clubs) {
        for (const clubIds of Object.values(channelData.clubs)) {
          for (const clubId of clubIds) {
            if (!clubMap.has(clubId)) {
              clubMap.set(clubId, []);
            }
            clubMap.get(clubId).push(channelId);
          }
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
  getStats() {
    return { ...this.stats };
  }

  // Nettoyer les notifications anciennes du cache
  cleanupOldNotifications() {
    // Garder seulement les notifications des 7 derniers jours
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    let cleanedCount = 0;

    for (const notifKey of this.sentNotifications) {
      // Format: clubId_matchId_lineup
      const parts = notifKey.split('_');
      if (parts.length >= 3) {
        // Vérifier si la notification est ancienne (logique simplifiée)
        // Dans un vrai cas, il faudrait stocker les timestamps
        cleanedCount++;
      }
    }

    if (cleanedCount > 100) {
      this.sentNotifications.clear();
      logger.info(`🧹 Cache notifications nettoyé: ${cleanedCount} entrées supprimées`);
    }
  }
}

module.exports = MatchNotificationWatcher;
