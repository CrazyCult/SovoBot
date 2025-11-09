const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

class ClubNewsWatcher {
  constructor(client, dataManager, apiClient) {
    this.client = client;
    this.dataManager = dataManager;
    this.apiClient = apiClient;

    // Charger les messages déjà traités
    this.processedMessages = this.loadProcessedMessages();

    // Vérification toutes les 4h (4 * 60 * 60 * 1000 ms)
    this.checkInterval = 4 * 60 * 60 * 1000;

    // Saison par défaut (peut être ajustée dynamiquement)
    this.defaultSeasonId = 2;

    // Sauvegarde automatique toutes les 10 minutes
    setInterval(() => {
      this.saveProcessedMessages();
    }, 10 * 60 * 1000);

    this.startWatching();
  }

  // Charger les messages déjà traités depuis le cache
  loadProcessedMessages() {
    try {
      const settings = this.dataManager.getChannelSettings('_global_news');

      if (settings && settings.processedMessages) {
        const map = new Map();
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

        // Charger tous les messages récents (30 derniers jours)
        for (const [key, data] of Object.entries(settings.processedMessages)) {
          if (data.timestamp > thirtyDaysAgo) {
            map.set(key, data);
          }
        }

        logger.info(`📰 ${map.size} message(s) d'actualités déjà traité(s) chargé(s) depuis le cache (30 derniers jours)`);
        return map;
      }
    } catch (error) {
      logger.warn('⚠️ Impossible de charger le cache des actualités:', error.message);
    }

    return new Map();
  }

  // Sauvegarder les messages traités
  async saveProcessedMessages() {
    try {
      const processedMessagesObj = {};
      for (const [key, data] of this.processedMessages.entries()) {
        processedMessagesObj[key] = data;
      }

      this.dataManager.setChannelSettings('_global_news', {
        processedMessages: processedMessagesObj,
        lastSaved: Date.now()
      });

      await this.dataManager.save();

      logger.debug(`💾 Cache actualités sauvegardé: ${this.processedMessages.size} entrée(s)`);
    } catch (error) {
      logger.error('❌ Erreur lors de la sauvegarde du cache actualités:', error);
    }
  }

  startWatching() {
    // Première vérification après 30 secondes (pour laisser le temps au bot de démarrer)
    setTimeout(() => {
      this.checkClubNews();
    }, 30000);

    // Puis vérifier toutes les 4h
    setInterval(() => {
      this.checkClubNews();
    }, this.checkInterval);

    logger.info('📰 Surveillance actualités des clubs démarrée (vérification toutes les 4h)');
  }

  async checkClubNews() {
    try {
      const registeredClubs = this.dataManager.getAllRegisteredClubs();

      if (registeredClubs.length === 0) {
        logger.debug('📰 Aucun club inscrit, skip vérification actualités');
        return;
      }

      logger.info(`📰 Vérification actualités pour ${registeredClubs.length} club(s)`);

      // Vérifier chaque club avec un délai pour éviter de surcharger l'API
      for (let i = 0; i < registeredClubs.length; i++) {
        const clubId = parseInt(registeredClubs[i]);

        setTimeout(async () => {
          try {
            await this.checkClubMessages(clubId);
          } catch (error) {
            logger.error(`❌ Erreur vérification actualités club ${clubId}:`, error.message);
          }
        }, i * 2000); // 2 secondes d'écart entre chaque club
      }

      // Nettoyage des anciens messages
      this.cleanupProcessedMessages();

    } catch (error) {
      logger.error('❌ Erreur surveillance actualités globale:', error);
    }
  }

  async checkClubMessages(clubId) {
    try {
      // Appeler l'API pour récupérer les messages du club
      const result = await this.apiClient.makeRpcRequest('get_club_messages', {
        club_id: clubId,
        season_id: this.defaultSeasonId
      });

      if (!result || !result.data) {
        logger.debug(`📰 Aucune donnée d'actualités pour le club ${clubId}`);
        return;
      }

      const messages = result.data;

      // Trier par date (ordre chronologique)
      messages.sort((a, b) => a.date - b.date);

      // Filtrer les nouveaux messages (pas encore traités)
      const newMessages = messages.filter(msg => {
        const messageKey = `${clubId}_${msg.message_id}`;
        return !this.processedMessages.has(messageKey);
      });

      if (newMessages.length === 0) {
        logger.debug(`📰 Aucune nouvelle actualité pour le club ${clubId}`);
        return;
      }

      logger.info(`📰 ${newMessages.length} nouvelle(s) actualité(s) détectée(s) pour le club ${clubId}`);

      // Traiter chaque nouveau message
      for (const message of newMessages) {
        await this.processClubMessage(clubId, message);
      }

    } catch (error) {
      if (error.message.includes('429') || error.message.includes('timeout')) {
        logger.warn(`⚠️ Rate limit/timeout club ${clubId}, skip actualités`);
      } else {
        logger.error(`❌ Erreur récupération actualités club ${clubId}:`, error);
      }
    }
  }

  async processClubMessage(clubId, message) {
    const messageKey = `${clubId}_${message.message_id}`;

    // Double vérification pour éviter les doublons
    if (this.processedMessages.has(messageKey)) {
      logger.warn(`⚠️ Message ${messageKey} déjà traité, skip`);
      return;
    }

    // Filtrer uniquement les types de messages pertinents
    const relevantTypes = [7, 9, 83, 92, 94, 96, 500, 501, 504];

    if (!relevantTypes.includes(message.type)) {
      logger.debug(`📰 Message type ${message.type} ignoré (non pertinent)`);
      // Marquer comme traité pour ne plus le vérifier
      this.processedMessages.set(messageKey, {
        timestamp: Date.now(),
        clubId: clubId,
        messageId: message.message_id,
        type: message.type
      });
      return;
    }

    // Marquer comme traité
    this.processedMessages.set(messageKey, {
      timestamp: Date.now(),
      clubId: clubId,
      messageId: message.message_id,
      type: message.type,
      date: message.date
    });

    // Sauvegarder immédiatement
    await this.saveProcessedMessages();

    logger.info(`📰 Nouvelle actualité à notifier: Club ${clubId}, Type ${message.type}, Message ID ${message.message_id}`);

    // Envoyer la notification
    await this.sendNewsNotification(clubId, message);
  }

  async sendNewsNotification(clubId, message) {
    try {
      const channelsForClub = this.dataManager.getChannelsForClub(clubId);

      if (channelsForClub.length === 0) {
        logger.debug(`📰 Aucun canal pour le club ${clubId}, skip notification`);
        return;
      }

      // Créer le message de notification
      const newsMessage = this.formatNewsMessage(message);
      const messageDate = new Date(message.date * 1000);

      for (const channelId of channelsForClub) {
        try {
          const channel = this.client.channels.cache.get(channelId);
          if (!channel) {
            logger.warn(`📰 Canal ${channelId} introuvable`);
            continue;
          }

          // Récupérer l'utilisateur qui a inscrit le club
          const mentionIds = this.getMentionIdsForClub(channelId, clubId);
          const mentions = mentionIds.length > 0 ? mentionIds.map(id => `<@${id}>`).join(' ') : '';

          // Créer un embed simple
          const embed = new EmbedBuilder()
            .setColor(this.getColorForMessageType(message.type))
            .setTitle(`📰 Actualité du Club #${clubId}`)
            .setDescription(newsMessage)
            .addFields({
              name: '📅 Date',
              value: messageDate.toLocaleDateString('fr-FR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              }),
              inline: true
            })
            .setTimestamp()
            .setFooter({ text: 'Soccerverse Bot v3.0' });

          await channel.send({
            content: mentions,
            embeds: [embed]
          });

        } catch (error) {
          logger.error(`❌ Erreur envoi notification actualité canal ${channelId}:`, error);
        }
      }

      logger.info(`📰 Notification actualité envoyée: Club ${clubId}, ${channelsForClub.length} canal(aux)`);

    } catch (error) {
      logger.error('❌ Erreur envoi notification actualité:', error);
    }
  }

  formatNewsMessage(message) {
    const type = message.type;
    const playerId = message.data_1;
    const data2 = message.data_2;
    const club1 = message.club_1;
    const club2 = message.club_2;
    const name = message.name_1;

    switch(type) {
      case 7:
        return `🔒 Le joueur #${playerId} a été retiré du marché.`;

      case 9:
        if (club1 === 0) {
          return `💰 Le joueur #${playerId} est arrivé du club #${club2} pour ${data2.toLocaleString()} $.`;
        } else {
          return `💰 Le joueur #${playerId} a été transféré au club #${club2} pour ${data2.toLocaleString()} $.`;
        }

      case 83:
        return `🏷️ Le joueur #${playerId} a été mis en vente.`;

      case 92:
        return `🤕 Le joueur #${playerId} est blessé pour ${data2} jours.`;

      case 94:
        return `🚑 Le joueur #${playerId} a une blessure sérieuse pour ${data2} jours.`;

      case 96:
        return `🟥 Le joueur #${playerId} est suspendu pour ${data2} match${data2 > 1 ? 's' : ''}.`;

      case 500:
        return `👨‍💼 ${name || 'Un nouveau manager'} arrive comme manager.`;

      case 501:
        return `👨‍💼 ${name || 'Un nouvel entraineur'} arrive comme entraineur.`;

      case 504:
        return `👋 ${name || 'L\'entraineur'} quitte son poste d'entraineur.`;

      default:
        return `❓ Nouvelle actualité (Type ${type})`;
    }
  }

  getColorForMessageType(type) {
    switch(type) {
      case 9: // Transfert
        return '#3498db'; // Bleu
      case 92: // Blessure
      case 94: // Blessure sérieuse
        return '#e74c3c'; // Rouge
      case 96: // Suspension
        return '#e67e22'; // Orange
      case 83: // Mis en vente
        return '#f39c12'; // Jaune
      case 7: // Retiré du marché
        return '#95a5a6'; // Gris
      case 500: // Manager
      case 501: // Entraineur
      case 504: // Départ entraineur
        return '#9b59b6'; // Violet
      default:
        return '#34495e'; // Bleu foncé
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

  cleanupProcessedMessages() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    let cleanedCount = 0;

    for (const [key, messageData] of this.processedMessages.entries()) {
      if (messageData.timestamp < thirtyDaysAgo) {
        this.processedMessages.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.saveProcessedMessages().catch(err => {
        logger.error('❌ Erreur sauvegarde après nettoyage actualités:', err);
      });
      logger.info(`🧹 Cache actualités nettoyé: ${cleanedCount} message(s) ancien(s) supprimé(s) (>30 jours)`);
    }

    logger.debug(`🧹 Nettoyage actualités: ${this.processedMessages.size} messages traités`);
  }

  getNewsStats() {
    return {
      processedMessagesCount: this.processedMessages.size,
      checkInterval: this.checkInterval / 1000 / 60 / 60, // En heures
      defaultSeasonId: this.defaultSeasonId,
      method: 'Vérification toutes les 4h'
    };
  }

  async forceCheckNews() {
    logger.info('🔄 Vérification forcée actualités...');
    await this.checkClubNews();
  }

  resetNewsCache() {
    this.processedMessages.clear();

    this.saveProcessedMessages().catch(err => {
      logger.error('❌ Erreur sauvegarde après reset actualités:', err);
    });

    logger.info('🔄 Cache actualités réinitialisé');
  }

  debugProcessedMessages() {
    logger.debug('=== ACTUALITÉS DEBUG ===');
    logger.debug(`Messages traités: ${this.processedMessages.size}`);
    for (const [key, messageData] of this.processedMessages.entries()) {
      const timeAgo = Math.round((Date.now() - messageData.timestamp) / 60000);
      logger.debug(`  ${key}: il y a ${timeAgo}min - Club ${messageData.clubId}, Type ${messageData.type}`);
    }
    logger.debug('=== FIN DEBUG ACTUALITÉS ===');
  }
}

module.exports = ClubNewsWatcher;
