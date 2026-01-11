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
        const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000); // 🔥 60 jours pour éviter les doublons

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
      const registeredClubs = this.dataManager.getAllRegisteredClubs();

      if (registeredClubs.length === 0) {
        logger.debug('📰 Aucun club inscrit, skip vérification actualités');
        return;
      }

      logger.info(`📰 Vérification actualités pour ${registeredClubs.length} club(s)`);

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
      // Appeler l'API pour récupérer les messages du club
      const result = await this.apiClient.makeRpcRequest('get_club_messages', {
        club_id: clubId,
        season_id: this.defaultSeasonId
      });

      // 🔥 CORRECTION CRITIQUE: L'API retourne directement un array dans result, pas result.data
      let messages = [];

      if (!result) {
        logger.debug(`📰 Aucune donnée d'actualités pour le club ${clubId}`);
        return;
      }

      // La réponse peut être soit directement un array, soit un objet avec .data
      if (Array.isArray(result)) {
        messages = result;
      } else if (result.data && Array.isArray(result.data)) {
        messages = result.data;
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

      // 🔥 NOUVELLE VÉRIFICATION: Filtrer les messages trop anciens (>7 jours)
      // Cela évite de re-notifier de vieilles actualités si le cache a été perdu
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
          const mentions = mentionIds.length > 0 ? mentionIds.map(id => `<@${id}>`).join(' ') : '';

          // Créer un embed simple
          const embed = new EmbedBuilder()
            .setColor(this.getColorForMessageType(message.type))
            .setTitle(`📰 Actualité - ${clubName}`)
            .setDescription(newsMessage)
            .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`)
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

          // Ajouter un lien vers le joueur si c'est un événement joueur
          if (message.data_1 && [7, 9, 81, 83, 92, 94, 96, 97, 98].includes(message.type)) {
            embed.addFields({
              name: '🔗 Liens',
              value: `[Voir le joueur](https://play.soccerverse.com/player/${message.data_1}) • [Voir le club](https://play.soccerverse.com/club/${clubId})`,
              inline: false
            });
          }

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

  formatNewsMessage(message, clubId) {
    const type = message.type;
    const playerId = message.data_1;
    const data2 = message.data_2;
    const club1 = parseInt(message.club_1);
    const club2 = parseInt(message.club_2);
    const name = message.name_1;
    const clubIdNum = parseInt(clubId);

    // Récupérer le nom du joueur si c'est un événement joueur
    const playerName = playerId ? this.apiClient.getPlayerName(playerId) : null;
    const club1Name = club1 ? this.apiClient.getClubName(club1) : null;
    const club2Name = club2 ? this.apiClient.getClubName(club2) : null;

    switch(type) {
      case 7:
        return `🔒 **${playerName}** a été retiré du marché.`;

      case 9:
        // Diviser le montant par 10 000 pour avoir le montant en dollars
        const amount = Math.round(data2 / 10000);

        // Si club1 === 0, le joueur arrive en free agent
        if (club1 === 0) {
          return `💰 **${playerName}** est arrivé (free agent) pour **${amount.toLocaleString()} $**.`;
        }
        // Si club1 === clubId, le joueur PART du club surveillé vers club2
        else if (club1 === clubIdNum) {
          return `💰 **${playerName}** a quitté le club pour rejoindre **${club2Name}** pour **${amount.toLocaleString()} $**.`;
        }
        // Si club2 === clubId, le joueur ARRIVE au club surveillé depuis club1
        else if (club2 === clubIdNum) {
          return `💰 **${playerName}** est arrivé de **${club1Name}** pour **${amount.toLocaleString()} $**.`;
        }
        // Cas par défaut (ne devrait pas arriver)
        else {
          return `💰 Transfert de **${playerName}** : ${club1Name} → ${club2Name} pour **${amount.toLocaleString()} $**.`;
        }

      case 81:
        // Renouvellement de contrat
        const contractAmount = Math.round(data2 / 10000);
        return `📝 **${playerName}** a renouvelé son contrat pour **${contractAmount.toLocaleString()} $**.`;

      case 83:
        return `🏷️ **${playerName}** a été mis en vente.`;

      case 92:
        return `🤕 **${playerName}** est blessé pour **${data2} jour${data2 > 1 ? 's' : ''}**.`;

      case 94:
        return `🚑 **${playerName}** a une blessure sérieuse pour **${data2} jour${data2 > 1 ? 's' : ''}**.`;

      case 96:
        return `🟥 **${playerName}** est suspendu pour **${data2} match${data2 > 1 ? 's' : ''}**.`;

      case 97:
        // Suspension de 3 matchs suite à une expulsion
        return `🟥🟥 **${playerName}** est suspendu pour **3 matchs** suite à son expulsion.`;

      case 98:
        // Suspension pour accumulation de cartons jaunes
        return `🟨➡️🟥 **${playerName}** est suspendu pour **${data2} match${data2 > 1 ? 's' : ''}** (accumulation de cartons jaunes).`;

      case 255:
        // Passage au tour suivant de la coupe
        const cupName = name || 'la coupe';
        return `🏆✨ Le club est qualifié pour le tour suivant de **${cupName}** !`;

      case 500:
        return `👨‍💼 **${name || 'Un nouveau manager'}** arrive comme manager.`;

      case 501:
        return `👨‍💼 **${name || 'Un nouvel entraineur'}** arrive comme entraineur.`;

      case 504:
        return `👋 **${name || 'L\'entraineur'}** quitte son poste d'entraineur.`;

      default:
        return `❓ Nouvelle actualité (Type ${type})`;
    }
  }

  getColorForMessageType(type) {
    switch(type) {
      case 9: // Transfert
        return '#3498db'; // Bleu
      case 81: // Renouvellement de contrat
        return '#2ecc71'; // Vert (succès)
      case 92: // Blessure
      case 94: // Blessure sérieuse
        return '#e74c3c'; // Rouge
      case 96: // Suspension
      case 97: // Suspension 3 matchs (expulsion)
      case 98: // Suspension (cartons jaunes)
        return '#e67e22'; // Orange
      case 83: // Mis en vente
        return '#f39c12'; // Jaune
      case 7: // Retiré du marché
        return '#95a5a6'; // Gris
      case 255: // Qualification coupe
        return '#f1c40f'; // Or (succès)
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
    const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000); // 🔥 60 jours pour éviter les doublons
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
