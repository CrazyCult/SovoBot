const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');
const axios = require('axios');
const cron = require('node-cron');

class ClubFollowerWatcher {
  constructor(client, dataManager, apiClient) {
    this.client = client;
    this.dataManager = dataManager;
    this.apiClient = apiClient;

    // État de chaque canal de suivi
    this.channelConfigs = new Map(); // channelId -> { username, minInfluence, clubs: [], currentIndex: 0, cache: {} }

    // Vérification toutes les 3 minutes (rotation)
    this.checkInterval = 3 * 60 * 1000;

    // 🔧 CORRECTION: Saison dynamique au lieu de hardcodé
    this.defaultSeasonId = null;

    // Charger les configurations sauvegardées
    this.loadConfigurations();

    // Initialiser la saison dynamiquement
    this.initializeSeasonId();

    // Démarrer le monitoring en rotation
    this.startRotation();
  }

  // 🆕 NOUVELLE MÉTHODE: Récupérer la saison dynamiquement
  async initializeSeasonId() {
    try {
      this.defaultSeasonId = await this.apiClient.getCurrentSeason();
      logger.info(`📅 ClubFollowerWatcher: Saison courante détectée: ${this.defaultSeasonId}`);
    } catch (error) {
      logger.warn('⚠️ ClubFollowerWatcher: Impossible de récupérer la saison, fallback sur 3');
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

  // =================== CHARGEMENT/SAUVEGARDE ===================

  loadConfigurations() {
    try {
      const settings = this.dataManager.getChannelSettings('_global_follower');

      if (settings && settings.configurations) {
        for (const [channelId, config] of Object.entries(settings.configurations)) {
          // Reconstruire le cache avec les Sets
          const cache = {};
          if (config.cache) {
            for (const [clubId, clubCache] of Object.entries(config.cache)) {
              cache[clubId] = {
                ...clubCache,
                // Convertir l'array messageIds en Set
                messageIds: new Set(clubCache.messageIds || [])
              };
            }
          }

          this.channelConfigs.set(channelId, {
            username: config.username,
            minInfluence: config.minInfluence,
            clubs: config.clubs || [],
            currentIndex: 0,
            cache: cache,
            startedAt: config.startedAt,
            startedBy: config.startedBy
          });
        }
        logger.info(`📊 ${this.channelConfigs.size} configuration(s) de suivi chargée(s)`);
      }
    } catch (error) {
      logger.warn('⚠️ Impossible de charger les configurations de suivi:', error.message);
    }
  }

  async saveConfigurations() {
    try {
      const configurations = {};

      for (const [channelId, config] of this.channelConfigs.entries()) {
        // Convertir les Sets en Arrays pour la sauvegarde JSON
        const cache = {};
        for (const [clubId, clubCache] of Object.entries(config.cache)) {
          cache[clubId] = {
            ...clubCache,
            messageIds: Array.from(clubCache.messageIds || [])
          };
        }

        configurations[channelId] = {
          username: config.username,
          minInfluence: config.minInfluence,
          clubs: config.clubs,
          cache: cache,
          startedAt: config.startedAt,
          startedBy: config.startedBy
        };
      }

      this.dataManager.setChannelSettings('_global_follower', {
        configurations: configurations,
        lastSaved: Date.now()
      });

      await this.dataManager.save();
      logger.debug(`💾 Configurations de suivi sauvegardées: ${this.channelConfigs.size} canal(aux)`);
    } catch (error) {
      logger.error('❌ Erreur sauvegarde configurations suivi:', error);
    }
  }

  // =================== API CALLS ===================

  async fetchShareBalances(username, minInfluence) {
    try {
      let allShares = [];
      let page = 1;
      let totalPages = 1;

      while (page <= totalPages) {
        const response = await axios.get('https://services.soccerverse.com/api/share_balances', {
          params: {
            page: page,
            per_page: 50,
            sort_by: 'share_type',
            sort_order: 'asc',
            name: username,
            countries: false,
            leagues: false
          },
          timeout: 10000,
          headers: this.apiClient.getBotHeaders()
        });

        totalPages = response.data.total_pages;

        const clubShares = response.data.items.filter(item =>
          item.share_type === 'club' && item.num >= minInfluence
        );

        allShares = allShares.concat(clubShares);
        page++;

        // Petit délai entre les pages
        if (page <= totalPages) {
          await this.sleep(200);
        }
      }

      return allShares;
    } catch (error) {
      logger.error(`❌ Erreur récupération parts pour ${username}:`, error.message);
      throw error;
    }
  }

  async fetchClubDetails(clubId) {
    try {
      return await this.apiClient.getClubDetails(clubId);
    } catch (error) {
      logger.error(`❌ Erreur détails club ${clubId}:`, error.message);
      return null;
    }
  }

  // 🔧 MÉTHODE CORRIGÉE: Utiliser l'endpoint REST /messages au lieu de RPC
  async fetchClubMessages(clubId) {
    try {
      // S'assurer que la saison est initialisée
      const seasonId = await this.ensureSeasonId();

      // Utiliser l'endpoint REST /messages au lieu de RPC
      const response = await this.apiClient.makeRequest('/messages', {
        club_id: clubId,
        season_id: seasonId
      });

      // L'API retourne { items: [...], total: X }
      if (!response || !response.items) {
        logger.debug(`📰 Aucun message pour le club ${clubId}`);
        return [];
      }

      logger.debug(`📰 ${response.items.length} message(s) récupéré(s) pour le club ${clubId}`);
      return response.items;
      
    } catch (error) {
      // Si l'erreur est 404, c'est que le club n'a pas de messages, pas une vraie erreur
      if (error.message && error.message.includes('404')) {
        logger.debug(`📰 Aucun message disponible pour le club ${clubId}`);
        return [];
      }
      
      logger.debug(`⚠️ Impossible de récupérer les messages du club ${clubId}: ${error.message}`);
      return [];
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // =================== CONFIGURATION ===================

  async startFollowing(channelId, username, minInfluence, userId) {
    try {
      logger.info(`📊 Démarrage suivi pour ${username} (min ${minInfluence} parts) dans ${channelId}`);

      // Récupérer les parts
      const shares = await this.fetchShareBalances(username, minInfluence);

      if (shares.length === 0) {
        return { success: false, error: 'Aucun club trouvé avec ce nombre de parts' };
      }

      // Filtrer les doublons (clubs déjà suivis PAR LE MÊME UTILISATEUR dans d'autres salons)
      const alreadyFollowed = this.getAlreadyFollowedClubs(userId, channelId);
      const filteredShares = shares.filter(share =>
        !alreadyFollowed.includes(share.club_id.toString())
      );

      if (filteredShares.length === 0) {
        return {
          success: false,
          error: `Tous les clubs (${shares.length}) sont déjà suivis dans vos autres salons`
        };
      }

      // Créer la configuration
      const config = {
        username: username,
        minInfluence: minInfluence,
        clubs: filteredShares,
        currentIndex: 0,
        cache: {},
        startedAt: Date.now(),
        startedBy: userId
      };

      this.channelConfigs.set(channelId, config);

      // Initialiser le cache pour tous les clubs
      logger.info(`📊 Initialisation du cache pour ${filteredShares.length} clubs...`);
      for (const share of filteredShares) {
        await this.initializeClubCache(channelId, share);
        await this.sleep(500); // Délai pour éviter de surcharger l'API
      }

      await this.saveConfigurations();

      return {
        success: true,
        totalClubs: shares.length,
        followedClubs: filteredShares.length,
        excludedClubs: shares.length - filteredShares.length
      };

    } catch (error) {
      logger.error(`❌ Erreur démarrage suivi:`, error);
      return { success: false, error: error.message };
    }
  }

  async addClubToFollow(channelId, clubId, userId) {
    try {
      logger.info(`📊 Ajout du club ${clubId} au suivi dans ${channelId}`);

      // Vérifier que le club existe
      const clubDetails = await this.fetchClubDetails(clubId);
      if (!clubDetails) {
        return { success: false, error: `Club #${clubId} introuvable` };
      }

      // Récupérer ou créer la configuration
      let config = this.channelConfigs.get(channelId);

      if (!config) {
        // Créer une nouvelle configuration
        config = {
          username: null, // Pas de username pour un suivi manuel
          minInfluence: null,
          clubs: [],
          currentIndex: 0,
          cache: {},
          startedAt: Date.now(),
          startedBy: userId
        };
        this.channelConfigs.set(channelId, config);
      }

      // Vérifier si le club est déjà suivi
      const alreadyFollowed = config.clubs.some(share => share.club_id === clubId);
      if (alreadyFollowed) {
        return { success: false, error: `Le club #${clubId} est déjà suivi dans ce salon` };
      }

      // Ajouter le club à la liste
      config.clubs.push({
        club_id: clubId,
        num: 0, // Pas de parts car c'est un suivi manuel
        share_type: 'club'
      });

      // Initialiser le cache pour ce club
      await this.initializeClubCache(channelId, { club_id: clubId, num: 0 });

      await this.saveConfigurations();

      return {
        success: true,
        clubName: this.apiClient.getClubName(clubId),
        clubId: clubId
      };

    } catch (error) {
      logger.error(`❌ Erreur ajout club ${clubId}:`, error);
      return { success: false, error: error.message };
    }
  }

  stopFollowing(channelId) {
    if (!this.channelConfigs.has(channelId)) {
      return { success: false, error: 'Aucun suivi actif dans ce salon' };
    }

    this.channelConfigs.delete(channelId);
    this.saveConfigurations();

    logger.info(`📊 Suivi arrêté dans ${channelId}`);
    return { success: true };
  }

  removeClubFromFollowing(channelId, clubId) {
    const config = this.channelConfigs.get(channelId);

    if (!config) {
      return { success: false, error: 'Aucun suivi actif dans ce salon' };
    }

    // Chercher le club dans la liste
    const clubIndex = config.clubs.findIndex(share => share.club_id === clubId);

    if (clubIndex === -1) {
      return { success: false, error: `Le club #${clubId} n'est pas suivi dans ce salon` };
    }

    // Retirer le club
    const removedClub = config.clubs.splice(clubIndex, 1)[0];

    // Retirer le cache associé
    if (config.cache[clubId]) {
      delete config.cache[clubId];
    }

    // Ajuster l'index actuel si nécessaire
    if (config.currentIndex >= config.clubs.length && config.clubs.length > 0) {
      config.currentIndex = 0;
    }

    // Si plus de clubs, supprimer la configuration
    if (config.clubs.length === 0) {
      this.channelConfigs.delete(channelId);
      logger.info(`📊 Plus de clubs suivis, suivi arrêté dans ${channelId}`);
    }

    this.saveConfigurations();

    logger.info(`📊 Club ${clubId} retiré du suivi dans ${channelId}`);
    return {
      success: true,
      clubId: clubId,
      clubName: this.apiClient.getClubName(clubId),
      remainingClubs: config.clubs.length
    };
  }

  getFollowingStatus(channelId) {
    const config = this.channelConfigs.get(channelId);

    if (!config) {
      return null;
    }

    return {
      username: config.username,
      minInfluence: config.minInfluence,
      clubCount: config.clubs.length,
      currentIndex: config.currentIndex,
      startedAt: config.startedAt,
      startedBy: config.startedBy,
      nextCheckIn: this.checkInterval / 1000 / 60 // minutes
    };
  }

  // =================== MISE À JOUR HEBDOMADAIRE ===================

  async refreshAllPortfolios() {
    logger.info('🔄 Début de la mise à jour hebdomadaire des portefeuilles...');

    let totalUpdated = 0;
    let totalErrors = 0;

    for (const [channelId, config] of this.channelConfigs.entries()) {
      // Ignorer les suivis manuels de clubs (sans username)
      if (!config.username) {
        logger.debug(`⏭️ Skip ${channelId}: suivi manuel de clubs (pas de portefeuille)`);
        continue;
      }

      try {
        logger.info(`🔄 Mise à jour du portefeuille de ${config.username} dans ${channelId}...`);

        // Récupérer les parts actuelles depuis l'API
        const currentShares = await this.fetchShareBalances(config.username, config.minInfluence);

        // Filtrer les doublons (clubs déjà suivis par cet utilisateur ailleurs)
        const alreadyFollowed = this.getAlreadyFollowedClubs(config.startedBy, channelId);
        const filteredShares = currentShares.filter(share =>
          !alreadyFollowed.includes(share.club_id.toString())
        );

        // Comparer avec les clubs actuellement suivis
        const oldClubIds = new Set(config.clubs.map(c => c.club_id));
        const newClubIds = new Set(filteredShares.map(c => c.club_id));

        // Clubs à ajouter (nouveaux au-dessus du seuil)
        const clubsToAdd = filteredShares.filter(share => !oldClubIds.has(share.club_id));

        // Clubs à retirer (maintenant en-dessous du seuil ou vendus)
        const clubsToRemove = config.clubs.filter(club => !newClubIds.has(club.club_id));

        // Appliquer les changements
        if (clubsToAdd.length > 0 || clubsToRemove.length > 0) {
          // Mettre à jour la liste des clubs
          config.clubs = filteredShares;

          // Initialiser le cache pour les nouveaux clubs
          for (const share of clubsToAdd) {
            await this.initializeClubCache(channelId, share);
            await this.sleep(500); // Délai pour éviter de surcharger l'API
          }

          // Nettoyer le cache des clubs retirés
          for (const club of clubsToRemove) {
            if (config.cache[club.club_id]) {
              delete config.cache[club.club_id];
            }
          }

          // Réinitialiser l'index si nécessaire
          if (config.currentIndex >= config.clubs.length && config.clubs.length > 0) {
            config.currentIndex = 0;
          }

          // Sauvegarder
          await this.saveConfigurations();

          // Envoyer une notification à l'utilisateur
          await this.sendPortfolioUpdateNotification(channelId, config, clubsToAdd, clubsToRemove);

          totalUpdated++;
          logger.info(`✅ Portefeuille de ${config.username} mis à jour: +${clubsToAdd.length} clubs, -${clubsToRemove.length} clubs`);
        } else {
          logger.info(`✓ Aucun changement pour ${config.username}`);
        }

      } catch (error) {
        totalErrors++;
        logger.error(`❌ Erreur mise à jour portefeuille ${config.username} dans ${channelId}:`, error);
      }

      // Délai entre chaque portefeuille
      await this.sleep(2000);
    }

    logger.info(`🔄 Mise à jour hebdomadaire terminée: ${totalUpdated} portefeuille(s) mis à jour, ${totalErrors} erreur(s)`);
  }

  async sendPortfolioUpdateNotification(channelId, config, clubsAdded, clubsRemoved) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setColor('#5865f2')
        .setTitle('🔄 Mise à jour hebdomadaire du portefeuille')
        .setDescription(`Votre portefeuille **${config.username}** a été mis à jour automatiquement.`)
        .addFields({
          name: '⚙️ Configuration',
          value: `**Seuil minimum:** ${config.minInfluence} parts\n**Total clubs suivis:** ${config.clubs.length}`,
          inline: false
        });

      if (clubsAdded.length > 0) {
        const addedNames = clubsAdded
          .slice(0, 10)
          .map(c => `• ${this.apiClient.getClubName(c.club_id)} (${c.num.toLocaleString()} parts)`)
          .join('\n');

        embed.addFields({
          name: `➕ Clubs ajoutés (${clubsAdded.length})`,
          value: clubsAdded.length > 10
            ? `${addedNames}\n*... et ${clubsAdded.length - 10} autres*`
            : addedNames,
          inline: false
        });
      }

      if (clubsRemoved.length > 0) {
        const removedNames = clubsRemoved
          .slice(0, 10)
          .map(c => `• ${this.apiClient.getClubName(c.club_id)}`)
          .join('\n');

        embed.addFields({
          name: `➖ Clubs retirés (${clubsRemoved.length})`,
          value: clubsRemoved.length > 10
            ? `${removedNames}\n*... et ${clubsRemoved.length - 10} autres*`
            : removedNames,
          inline: false
        });
      }

      embed.addFields({
        name: '💡 Informations',
        value:
          '• Les clubs ajoutés ont dépassé votre seuil minimum\n' +
          '• Les clubs retirés sont maintenant en-dessous du seuil\n' +
          '• La surveillance continue automatiquement\n' +
          '• Prochaine mise à jour: dimanche prochain à 2h00',
        inline: false
      })
      .setFooter({ text: 'Mise à jour automatique hebdomadaire • Soccerverse Bot v3.0' })
      .setTimestamp();

      await channel.send({
        content: config.startedBy ? `<@${config.startedBy}>` : undefined,
        embeds: [embed]
      });

      logger.info(`📨 Notification de mise à jour envoyée à ${config.username} dans ${channelId}`);

    } catch (error) {
      logger.error('❌ Erreur envoi notification mise à jour:', error);
    }
  }

  // =================== ROTATION & MONITORING ===================

  startRotation() {
    // Vérifier un club toutes les 3 minutes
    setInterval(async () => {
      await this.checkNextClubs();
    }, this.checkInterval);

    // Sauvegarde automatique toutes les 5 minutes
    setInterval(async () => {
      if (this.channelConfigs.size > 0) {
        await this.saveConfigurations();
        logger.debug('💾 Sauvegarde automatique des configurations de suivi');
      }
    }, 5 * 60 * 1000);

    // 🔄 Mise à jour hebdomadaire des portefeuilles (dimanche à 2h)
    cron.schedule('0 2 * * 0', async () => {
      try {
        logger.info('🔄 Mise à jour hebdomadaire automatique des portefeuilles...');
        await this.refreshAllPortfolios();
      } catch (error) {
        logger.error('❌ Erreur mise à jour hebdomadaire:', error);
      }
    }, {
      scheduled: true,
      timezone: "Europe/Paris"
    });

    logger.info('📊 Rotation de surveillance des clubs démarrée (3 minutes par club)');
    logger.info('⏰ Mise à jour automatique des portefeuilles programmée: dimanche 2h00');
  }

  async checkNextClubs() {
    if (this.channelConfigs.size === 0) {
      return;
    }

    // Vérifier un club pour chaque canal actif
    for (const [channelId, config] of this.channelConfigs.entries()) {
      try {
        if (config.clubs.length === 0) continue;

        // Sélectionner le club suivant en rotation
        const share = config.clubs[config.currentIndex];
        config.currentIndex = (config.currentIndex + 1) % config.clubs.length;

        await this.checkClub(channelId, share, config);

        // Petit délai entre les canaux
        await this.sleep(1000);
      } catch (error) {
        logger.error(`❌ Erreur vérification club dans ${channelId}:`, error);
      }
    }
  }

  async initializeClubCache(channelId, share) {
    try {
      const config = this.channelConfigs.get(channelId);
      if (!config) return;

      const details = await this.fetchClubDetails(share.club_id);
      if (!details) return;

      const messages = await this.fetchClubMessages(share.club_id);

      config.cache[share.club_id] = {
        form: details.form,
        manager_name: details.manager_name,
        manager_last_active: details.manager_last_active_unix,
        league_position: details.league_position,
        balance: details.balance,
        messageIds: new Set(messages.map(m => m.message_id)),
        lastChecked: Date.now()
      };

      logger.debug(`✅ Cache initialisé pour club ${share.club_id}`);
    } catch (error) {
      logger.error(`❌ Erreur init cache club ${share.club_id}:`, error);
    }
  }

  async checkClub(channelId, share, config) {
    try {
      const clubName = this.apiClient.getClubName(share.club_id);
      logger.debug(`🔍 Vérification: ${clubName} (${share.club_id})`);

      const details = await this.fetchClubDetails(share.club_id);
      if (!details) return;

      const messages = await this.fetchClubMessages(share.club_id);

      // Détecter les changements
      const changes = this.detectChanges(share.club_id, details, messages, config);

      if (changes.hasChanges) {
        logger.info(`📊 Changements détectés pour ${clubName}`);
        await this.sendChangeNotification(channelId, share, details, changes);
      }

      // Mettre à jour le cache
      config.cache[share.club_id].lastChecked = Date.now();
      await this.saveConfigurations();

    } catch (error) {
      logger.error(`❌ Erreur check club ${share.club_id}:`, error);
    }
  }

  detectChanges(clubId, details, messages, config) {
    const cached = config.cache[clubId];

    if (!cached) {
      // Première vérification, initialiser
      config.cache[clubId] = {
        form: details.form,
        manager_name: details.manager_name,
        manager_last_active: details.manager_last_active_unix,
        league_position: details.league_position,
        balance: details.balance,
        messageIds: new Set(messages.map(m => m.message_id)),
        lastChecked: Date.now(),
        managerAbsentAlerted: false // Flag: déjà alerté pour manager inactif
      };
      return { hasChanges: false };
    }

    const changes = {
      hasChanges: false,
      newForm: null,
      newMessages: [],
      managerAlert: null,
      positionChange: null,
      balanceChange: null
    };

    // Changement de forme
    if (details.form !== cached.form) {
      changes.newForm = { old: cached.form, new: details.form };
      changes.hasChanges = true;
      cached.form = details.form;
    }

    // Nouveaux messages
    const newMessages = messages.filter(m => !cached.messageIds.has(m.message_id));
    if (newMessages.length > 0) {
      changes.newMessages = newMessages.slice(0, 10); // Max 10 messages
      changes.hasChanges = true;
      newMessages.forEach(m => cached.messageIds.add(m.message_id));
    }

    // Changement manager ou alerte absence
    const managerChanged = details.manager_name !== cached.manager_name;
    const now = Date.now() / 1000;
    const daysAbsent = details.manager_last_active_unix
      ? (now - details.manager_last_active_unix) / 86400
      : 999;

    if (managerChanged) {
      changes.managerAlert = {
        type: 'change',
        old: cached.manager_name,
        new: details.manager_name
      };
      changes.hasChanges = true;
      cached.manager_name = details.manager_name;
      cached.manager_last_active = details.manager_last_active_unix;
      // Réinitialiser le flag car nouveau manager
      cached.managerAbsentAlerted = false;
    } else if (daysAbsent > 7) {
      // Manager absent depuis >7 jours
      // Alerter UNE SEULE FOIS, sauf si le statut change (redevient actif puis inactif)
      if (!cached.managerAbsentAlerted) {
        changes.managerAlert = {
          type: 'absent',
          days: Math.floor(daysAbsent)
        };
        changes.hasChanges = true;
        cached.managerAbsentAlerted = true; // Marquer comme déjà alerté
      }

      // Toujours mettre à jour la dernière activité connue
      cached.manager_last_active = details.manager_last_active_unix;
    } else if (daysAbsent <= 7) {
      // Manager actif ou récemment actif
      // Réinitialiser le flag si le manager était absent et redevient actif
      if (cached.managerAbsentAlerted) {
        cached.managerAbsentAlerted = false;
      }
      cached.manager_last_active = details.manager_last_active_unix;
    }

    // Changement de position
    if (details.league_position && details.league_position !== cached.league_position) {
      changes.positionChange = {
        old: cached.league_position,
        new: details.league_position
      };
      changes.hasChanges = true;
      cached.league_position = details.league_position;
    }

    // Changement significatif de trésorerie (>10%)
    if (cached.balance) {
      const diff = Math.abs(details.balance - cached.balance) / cached.balance;
      if (diff > 0.1) {
        changes.balanceChange = {
          old: cached.balance,
          new: details.balance,
          percent: diff * 100
        };
        changes.hasChanges = true;
      }
    }
    cached.balance = details.balance;

    return changes;
  }

  // =================== NOTIFICATIONS ===================

  async sendChangeNotification(channelId, share, details, changes) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        logger.warn(`📊 Canal ${channelId} introuvable`);
        return;
      }

      const config = this.channelConfigs.get(channelId);
      const clubName = this.apiClient.getClubName(details.club_id);

      // Construire l'embed
      const embed = new EmbedBuilder()
        .setColor('#5865f2')
        .setTitle(`📊 ${clubName}`)
        .setURL(`https://play.soccerverse.com/club/${details.club_id}`)
        .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${details.club_id}.png`)
        .setTimestamp()
        .setFooter({ text: `Suivi: ${config.username} • ${share.num.toLocaleString()} parts` });

      // Description des changements
      let description = '';

      if (changes.newForm) {
        description += `📊 **Forme:** ${this.formatFormCompact(changes.newForm.old)} → ${this.formatFormCompact(changes.newForm.new)}\n`;
      }

      if (changes.positionChange) {
        const better = changes.positionChange.new < changes.positionChange.old;
        description += `📍 **Classement:** ${changes.positionChange.old}e → ${changes.positionChange.new}e ${better ? '↗️' : '↘️'}\n`;
      }

      if (changes.balanceChange) {
        const oldBalance = this.apiClient.formatMoney(changes.balanceChange.old);
        const newBalance = this.apiClient.formatMoney(changes.balanceChange.new);
        const sign = changes.balanceChange.new > changes.balanceChange.old ? '+' : '';
        description += `💰 **Trésorerie:** ${oldBalance} → ${newBalance} (${sign}${changes.balanceChange.percent.toFixed(1)}%)\n`;
      }

      if (changes.managerAlert) {
        if (changes.managerAlert.type === 'change') {
          description += `👨‍💼 **Manager:** ${changes.managerAlert.old || 'Aucun'} → ${changes.managerAlert.new}\n`;
        } else if (changes.managerAlert.type === 'absent') {
          description += `⚠️ **Manager inactif depuis ${changes.managerAlert.days} jours**\n`;
        }
      }

      embed.setDescription(description || 'Changements détectés');

      // Champ "Infos"
      const managerStatus = this.getManagerStatusText(details.manager_last_active_unix);
      const formEmoji = this.formatFormWithEmoji(details.form);

      embed.addFields({
        name: '📋 Infos',
        value: `👨‍💼 ${details.manager_name || 'Sans entraîneur'} • ${managerStatus}\n` +
               `📊 Forme: ${formEmoji}\n` +
               `📍 Position: ${details.league_position || '-'}e\n` +
               `💰 ${this.apiClient.formatMoney(details.balance)}`,
        inline: false
      });

      // Champ "Actualités" si nouveaux messages
      if (changes.newMessages.length > 0) {
        const newsText = changes.newMessages
          .slice(0, 5)
          .map(msg => {
            const formatted = this.formatNewsMessage(msg, details.club_id);
            return `${formatted.emoji} ${formatted.text}`;
          })
          .join('\n');

        embed.addFields({
          name: `📰 Actualités (${changes.newMessages.length})`,
          value: newsText,
          inline: false
        });
      }

      // Mention de l'utilisateur qui a lancé le suivi
      const mentionUser = config.startedBy ? `<@${config.startedBy}>` : '';

      await channel.send({
        content: mentionUser,
        embeds: [embed]
      });

      logger.info(`📊 Notification envoyée: ${clubName} dans ${channelId}`);

    } catch (error) {
      logger.error('❌ Erreur envoi notification suivi:', error);
    }
  }

  // =================== HELPERS ===================

  getAlreadyFollowedClubs(userId, excludeChannelId = null) {
    const clubs = new Set();

    for (const [channelId, config] of this.channelConfigs.entries()) {
      if (channelId === excludeChannelId) continue;

      // Vérifier si c'est le même utilisateur qui a lancé le suivi
      // Cela permet à plusieurs utilisateurs de suivre les mêmes clubs dans leurs salons respectifs
      // mais empêche un utilisateur de suivre le même club dans plusieurs salons
      if (config.startedBy === userId) {
        for (const share of config.clubs) {
          clubs.add(share.club_id.toString());
        }
      }
    }

    return Array.from(clubs);
  }

  getManagerStatusText(timestamp) {
    if (!timestamp) return '⚫ Jamais actif';

    const now = Date.now() / 1000;
    const diff = now - timestamp;
    const hours = diff / 3600;
    const days = diff / 86400;

    if (hours < 1) return '🟢 En ligne';
    if (hours < 6) return `🟡 ${Math.floor(hours)}h`;
    if (days < 1) return `🟠 ${Math.floor(hours)}h`;
    if (days < 7) return `🔴 ${Math.floor(days)}j`;
    return `⚫ ${Math.floor(days)}j`;
  }

  formatFormCompact(form) {
    if (!form) return '-';
    return form.replace(/W/g, 'V').replace(/D/g, 'N').replace(/L/g, 'D');
  }

  formatFormWithEmoji(form) {
    if (!form) return '-';
    return form.split('').map(letter => {
      switch (letter) {
        case 'W': return '🟢';
        case 'D': return '🟡';
        case 'L': return '🔴';
        default: return '⚪';
      }
    }).join('');
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

  // =================== STATS ===================

  getStats() {
    const stats = {
      activeChannels: this.channelConfigs.size,
      totalClubs: 0,
      checkInterval: this.checkInterval / 1000 / 60 // minutes
    };

    for (const config of this.channelConfigs.values()) {
      stats.totalClubs += config.clubs.length;
    }

    return stats;
  }
}

module.exports = ClubFollowerWatcher;
