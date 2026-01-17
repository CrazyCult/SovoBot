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

    // 🔧 CORRECTION: Saison dynamique au lieu de hardcodé
    this.defaultSeasonId = null;

    // Initialiser la saison dynamiquement
    this.initializeSeasonId();

    // Sauvegarde automatique toutes les 10 minutes
    setInterval(() => {
      this.saveProcessedMessages();
    }, 10 * 60 * 1000);

    this.startWatching();
  }

  // 🆕 NOUVELLE MÉTHODE: Récupérer la saison dynamiquement
  async initializeSeasonId() {
    try {
      this.defaultSeasonId = await this.apiClient.getCurrentSeason();
      logger.info(`📅 ClubNewsWatcher: Saison courante détectée: ${this.defaultSeasonId}`);
    } catch (error) {
      logger.warn('⚠️ ClubNewsWatcher: Impossible de récupérer la saison, fallback sur 3');
      this.defaultSeasonId = 3;
    }
  }

  // 🆕 HELPER: S'assurer que la saison est initialisée
  async ensureSeasonId() {
    if (!this.defaultSeasonId) {
      await this.initializeSeasonId();
    }
    return this.defaultSeasonId;
  }

  // Charger les messages déjà traités depuis le cache
  loadProcessedMessages() {
    try {
      const settings = this.dataManager.getChannelSettings('_global_news');

      if (settings && settings.processedMessages) {
        const map = new Map();
        const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000);

        // Charger tous les messages récents (60 derniers jours)
        for (const [key, data] of Object.entries(settings.processedMessages)) {
          if (data.timestamp > sixtyDaysAgo) {
            map.set(key, data);
          }
        }

        logger.info(`📰 ${map.size} message(s) d'actualités déjà traité(s) chargé(s) depuis le cache (60 derniers jours)`);
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
      // S'assurer que la saison est initialisée
      await this.ensureSeasonId();

      const registeredClubs = this.dataManager.getAllRegisteredClubs();

      if (registeredClubs.length === 0) {
        logger.debug('📰 Aucun club inscrit, skip vérification actualités');
        return;
      }

      logger.info(`📰 Vérification actualités pour ${registeredClubs.length} club(s) (saison ${this.defaultSeasonId})`);

      // Vérifier chaque club avec un délai pour éviter de surcharger l'API
      let validClubIndex = 0;
      for (let i = 0; i < registeredClubs.length; i++) {
        const clubId = parseInt(registeredClubs[i]);

        // Ignorer les IDs invalides
        if (isNaN(clubId)) {
          logger.warn(`⚠️ ID de club invalide ignoré dans les actualités: "${registeredClubs[i]}"`);
          continue;
        }

        setTimeout(async () => {
          try {
            await this.checkClubMessages(clubId);
          } catch (error) {
            logger.error(`❌ Erreur vérification actualités club ${clubId}:`, error.message);
          }
        }, validClubIndex * 2000); // 2 secondes d'écart entre chaque club

        validClubIndex++;
      }

      // Nettoyage des anciens messages
      this.cleanupProcessedMessages();

    } catch (error) {
      logger.error('❌ Erreur surveillance actualités globale:', error);
    }
  }

  async checkClubMessages(clubId) {
    try {
      // S'assurer que la saison est initialisée
      const seasonId = await this.ensureSeasonId();

      // 🔧 CORRECTION: Utiliser l'endpoint REST /messages au lieu de RPC
      const response = await this.apiClient.makeRequest('/messages', {
        club_id: clubId,
        season_id: seasonId
      });

      let messages = [];

      if (!response) {
        logger.debug(`📰 Aucune donnée d'actualités pour le club ${clubId}`);
        return;
      }

      // L'API retourne { items: [...], total: X }
      if (response.items && Array.isArray(response.items)) {
        messages = response.items;
      } else if (Array.isArray(response)) {
        messages = response;
      } else {
        logger.debug(`📰 Format de réponse inattendu pour le club ${clubId}`);
        return;
      }

      if (messages.length === 0) {
        logger.debug(`📰 Aucun message d'actualités pour le club ${clubId}`);
        return;
      }

      // Trier par date (ordre chronologique)
      messages.sort((a, b) => a.date - b.date);

      // Filtrer les nouveaux messages (pas encore traités)
      const newMessages = messages.filter(msg => {
        const messageKey = `${clubId}_${msg.message_id}`;
        return !this.processedMessages.has(messageKey);
      });

      // Filtrer les messages trop anciens (>7 jours)
      const sevenDaysAgo = Date.now() / 1000 - (7 * 24 * 60 * 60);
      const recentMessages = newMessages.filter(msg => msg.date > sevenDaysAgo);

      // Marquer les vieux messages comme traités sans les notifier
      const oldMessages = newMessages.filter(msg => msg.date <= sevenDaysAgo);
      if (oldMessages.length > 0) {
        logger.debug(`📰 ${oldMessages.length} actualité(s) trop ancienne(s) pour le club ${clubId}, ajout au cache sans notification`);
        for (const msg of oldMessages) {
          const messageKey = `${clubId}_${msg.message_id}`;
          this.processedMessages.set(messageKey, {
            timestamp: Date.now(),
            clubId: clubId,
            messageId: msg.message_id,
            type: msg.type,
            date: msg.date
          });
        }
        await this.saveProcessedMessages();
      }

      if (recentMessages.length === 0) {
        logger.debug(`📰 Aucune nouvelle actualité récente pour le club ${clubId}`);
        return;
      }

      logger.info(`📰 ${recentMessages.length} nouvelle(s) actualité(s) récente(s) détectée(s) pour le club ${clubId}`);

      // Traiter chaque nouveau message récent
      for (const message of recentMessages) {
        await this.processClubMessage(clubId, message);
      }

    } catch (error) {
      if (error.message && error.message.includes('404')) {
        logger.debug(`📰 Aucun message disponible pour le club ${clubId}`);
      } else if (error.message.includes('429') || error.message.includes('timeout')) {
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
    const relevantTypes = [
      7,   // Retiré du marché
      9,   // Transfert
      81,  // Renouvellement de contrat
      83,  // Mis en vente
      92,  // Blessure
      94,  // Blessure sérieuse
      96,  // Suspension
      97,  // Suspension 3 matchs (expulsion)
      98,  // Suspension (accumulation cartons jaunes)
      255, // Passage au tour suivant de la coupe
      500, // Nouveau manager
      501, // Nouvel entraineur
      504  // Départ entraineur
    ];

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
      const newsMessage = this.formatNewsMessage(message, clubId);
      const messageDate = new Date(message.date * 1000);
      const clubName = this.apiClient.getClubName(clubId);

      for (const channelId of channelsForClub) {
        try {
          const channel = this.client.channels.cache.get(channelId);
          if (!channel) {
            logger.warn(`📰 Canal ${channelId} introuvable`);
            continue;
          }

          // Récupérer l'utilisateur qui a inscrit le club
          const mentionIds = this.getMentionIdsForClub(channelId, clubId);
          const mentions = mentionIds.length > 0 ?
            mentionIds.map(id => `<@${id}>`).join(' ') : undefined;

          // Créer l'embed
          const embed = new EmbedBuilder()
            .setColor(this.getNewsColor(message.type))
            .setTitle(`📰 ${clubName}`)
            .setDescription(`${newsMessage.emoji} **${newsMessage.text}**`)
            .addFields({
              name: '📅 Date',
              value: messageDate.toLocaleString('fr-FR'),
              inline: true
            })
            .setURL(`https://play.soccerverse.com/club/${clubId}`)
            .setTimestamp();

          await channel.send({
            content: mentions,
            embeds: [embed]
          });

          logger.info(`📰 Notification actualité envoyée: ${clubName} (type ${message.type}) → ${channelId}`);

        } catch (error) {
          logger.error(`❌ Erreur envoi notification dans canal ${channelId}:`, error);
        }
      }

    } catch (error) {
      logger.error('❌ Erreur envoi notification actualité:', error);
    }
  }

  formatNewsMessage(msg, currentClubId) {
    const type = msg.type;
    const playerId = msg.data_1;
    const data2 = msg.data_2;
    const club1 = msg.club_1;
    const club2 = msg.club_2;
    const name = msg.name_1;

    const playerName = playerId ? this.apiClient.getPlayerName(playerId) : null;

    switch(type) {
      case 7:
        return { emoji: '🔒', text: `${playerName} retiré du marché` };

      case 9:
        const isLeaving = club1 === currentClubId;
        const otherClubId = isLeaving ? club2 : club1;
        const otherClubName = this.apiClient.getClubName(otherClubId);
        const amount = Math.round(data2 / 10000);

        if (isLeaving) {
          return { emoji: '↗️', text: `${playerName} → ${otherClubName} (${this.apiClient.formatMoney(amount)})` };
        } else {
          return { emoji: '↘️', text: `${playerName} ← ${otherClubName} (${this.apiClient.formatMoney(amount)})` };
        }

      case 81:
        return { emoji: '📝', text: `${playerName} a renouvelé son contrat` };

      case 83:
        return { emoji: '🏷️', text: `${playerName} mis en vente` };

      case 92:
        return { emoji: '🤕', text: `${playerName} blessé (${data2}j)` };

      case 94:
        return { emoji: '🚑', text: `${playerName} blessure sérieuse (${data2}j)` };

      case 96:
        return { emoji: '🟥', text: `${playerName} suspendu (${data2} matchs)` };

      case 97:
        return { emoji: '🟥', text: `${playerName} expulsé (3 matchs)` };

      case 98:
        return { emoji: '🟨', text: `${playerName} suspendu (cartons jaunes)` };

      case 255:
        return { emoji: '🏆', text: 'Qualifié pour le tour suivant' };

      case 500:
      case 501:
        return { emoji: '👨‍💼', text: `${name} arrive` };

      case 504:
        return { emoji: '👋', text: `${name} quitte le club` };

      default:
        return { emoji: '📰', text: `Actualité (type ${type})` };
    }
  }

  getNewsColor(type) {
    switch(type) {
      case 7:   // Retiré du marché
      case 83:  // Mis en vente
        return '#3498db'; // Bleu
      case 9:   // Transfert
        return '#e74c3c'; // Rouge
      case 92:  // Blessure
      case 94:  // Blessure sérieuse
        return '#e67e22'; // Orange
      case 96:  // Suspension
      case 97:  // Expulsion
      case 98:  // Suspension cartons
        return '#c0392b'; // Rouge foncé
      case 255: // Qualification coupe
        return '#f1c40f'; // Or
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
    const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000);
    let cleanedCount = 0;

    for (const [key, messageData] of this.processedMessages.entries()) {
      if (messageData.timestamp < sixtyDaysAgo) {
        this.processedMessages.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.saveProcessedMessages().catch(err => {
        logger.error('❌ Erreur sauvegarde après nettoyage actualités:', err);
      });
      logger.info(`🧹 Cache actualités nettoyé: ${cleanedCount} message(s) ancien(s) supprimé(s) (>60 jours)`);
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
