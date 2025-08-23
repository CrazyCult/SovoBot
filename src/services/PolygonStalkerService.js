const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../utils/logger');

class PolygonStalkerService {
  constructor(client, dataManager) {
    this.client = client;
    this.dataManager = dataManager;
    
    // Configuration API
    this.POLYGONSCAN_API_URL = 'https://api.polygonscan.com/api';
    this.API_KEY = process.env.POLYGONSCAN_API_KEY || '';
    
    // Configuration retry pour les erreurs 502/503
    this.MAX_RETRIES = 3;
    this.RETRY_DELAYS = [2000, 5000, 10000]; // 2s, 5s, 10s
    
    // Intervalle adaptatif selon les erreurs
    this.checkInterval = 60 * 1000; // Commencer par 60s (plus conservateur)
    this.errorCount = 0;
    this.consecutiveErrors = 0;
    
    // Cache des dernières transactions
    this.lastTransactionHashes = new Map();
    
    // NOUVEAU: Flag pour éviter les notifications lors de la première vérification
    this.initializedUsers = new Set();
    
    // Compteurs pour monitoring
    this.stats = {
      totalChecks: 0,
      successfulChecks: 0,
      apiErrors: 0,
      rateLimitErrors: 0,
      serverErrors: 0
    };
    
    this.startWatching();
  }

  startWatching() {
    // Vérification initiale après 2 minutes
    setTimeout(() => {
      this.checkAllWatchedUsers();
    }, 120000);
    
    // Vérification périodique
    this.scheduleNextCheck();
    
    logger.info(`👥 Service Polygon Stalker démarré (intervalle initial: ${this.checkInterval/1000}s)`);
    
    if (this.API_KEY) {
      logger.info('🔑 API Key PolygonScan configurée - Mode robuste activé');
    } else {
      logger.warn('⚠️ Aucune API Key PolygonScan - Performance limitée');
    }
  }

  scheduleNextCheck() {
    setTimeout(() => {
      this.checkAllWatchedUsers();
      this.scheduleNextCheck();
    }, this.checkInterval);
  }

  async checkAllWatchedUsers() {
    try {
      const watchedUsers = this.getWatchedUsers();
      
      if (watchedUsers.length === 0) {
        return;
      }
      
      logger.debug(`👥 Vérification Stalker pour ${watchedUsers.length} utilisateur(s) (intervalle: ${this.checkInterval/1000}s)`);
      this.stats.totalChecks++;
      
      let successCount = 0;
      let errorCount = 0;
      
      for (const watch of watchedUsers) {
        try {
          await this.checkUserTransactions(watch);
          successCount++;
          
          // Délai entre utilisateurs pour éviter le rate limiting
          const delay = this.API_KEY ? 300 : 1500; // Plus conservateur
          await new Promise(resolve => setTimeout(resolve, delay));
          
        } catch (error) {
          errorCount++;
          logger.warn(`⚠️ Échec surveillance ${watch.username}: ${error.message}`);
        }
      }
      
      // Ajuster l'intervalle selon le taux de succès
      this.adjustCheckInterval(successCount, errorCount);
      this.stats.successfulChecks += successCount;
      
      if (errorCount === 0) {
        this.consecutiveErrors = 0;
      } else {
        this.consecutiveErrors++;
      }
      
    } catch (error) {
      logger.error('Erreur surveillance Stalker globale:', error);
      this.consecutiveErrors++;
    }
  }

  adjustCheckInterval(successCount, errorCount) {
    const totalUsers = successCount + errorCount;
    const errorRate = totalUsers > 0 ? errorCount / totalUsers : 0;
    
    // Ajuster l'intervalle selon le taux d'erreur
    if (errorRate > 0.5) {
      // Plus de 50% d'erreurs : ralentir drastiquement
      this.checkInterval = Math.min(this.checkInterval * 2, 300000); // Max 5 minutes
      logger.warn(`⚠️ Taux d'erreur élevé (${(errorRate*100).toFixed(1)}%) - Intervalle augmenté à ${this.checkInterval/1000}s`);
    } else if (errorRate > 0.2) {
      // Plus de 20% d'erreurs : ralentir modérément
      this.checkInterval = Math.min(this.checkInterval * 1.5, 180000); // Max 3 minutes
    } else if (errorRate === 0 && this.checkInterval > 60000) {
      // Aucune erreur : accélérer progressivement
      this.checkInterval = Math.max(this.checkInterval * 0.9, 60000); // Min 1 minute
    }
  }

  getWatchedUsers() {
    const watched = [];
    
    for (const [channelId, registrations] of this.dataManager.data.registrations.entries()) {
      const settings = this.dataManager.getChannelSettings(channelId);
      
      if (settings.stalkerWatching) {
        for (const [username, watchConfig] of Object.entries(settings.stalkerWatching)) {
          watched.push({
            channelId,
            username,
            wallet: watchConfig.wallet,
            namespace: watchConfig.namespace,
            tokenId: watchConfig.tokenId,
            addedAt: watchConfig.addedAt,
            lastTransactionHash: watchConfig.lastTransactionHash
          });
        }
      }
    }
    
    return watched;
  }

  async checkUserTransactions(watch) {
    const { channelId, username, wallet } = watch;
    
    // MODIFIÉ: Augmenter l'offset pour avoir plus de transactions
    let apiUrl = `${this.POLYGONSCAN_API_URL}?module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=20&sort=desc`;
    
    if (this.API_KEY) {
      apiUrl += `&apikey=${this.API_KEY}`;
    }
    
    // Retry avec backoff exponentiel
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await this.makeApiRequest(apiUrl, attempt);
        
        if (response && response.status === '1' && Array.isArray(response.result)) {
          await this.processTransactions(watch, response.result);
          return; // Succès !
        } else if (response && response.status === '0') {
          // Erreur API spécifique
          if (response.message.includes('rate limit')) {
            this.stats.rateLimitErrors++;
            logger.warn(`⚠️ Rate limit atteint pour ${username} - Attente plus longue`);
            throw new Error(`Rate limit: ${response.message}`);
          } else {
            logger.warn(`⚠️ Réponse API invalide pour ${username}: ${response.message}`);
            return; // Ne pas retry sur les erreurs logiques
          }
        }
        
      } catch (error) {
        const isServerError = error.response?.status >= 500 && error.response?.status < 600;
        const isNetworkError = !error.response || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
        
        if (isServerError || isNetworkError) {
          this.stats.serverErrors++;
          
          if (attempt < this.MAX_RETRIES) {
            const delay = this.RETRY_DELAYS[attempt - 1] || 10000;
            logger.warn(`⚠️ Tentative ${attempt}/${this.MAX_RETRIES} échouée pour ${username} (${error.message}) - Retry dans ${delay/1000}s`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          } else {
            logger.error(`❌ Toutes les tentatives échouées pour ${username}: ${error.message}`);
            throw error;
          }
        } else {
          this.stats.apiErrors++;
          logger.error(`❌ Erreur API non-retryable pour ${username}: ${error.message}`);
          throw error;
        }
      }
    }
  }

  async makeApiRequest(url, attempt) {
    const timeout = 15000 + (attempt * 5000); // Timeout croissant
    
    try {
      const response = await axios.get(url, {
        timeout: timeout,
        headers: {
          'User-Agent': 'SoccerverseBot/3.0',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        },
        // Retry sur les erreurs réseau
        retry: {
          retries: 0 // On gère nous-mêmes les retries
        }
      });
      
      if (response.status === 200 && response.data) {
        return response.data;
      }
      
    } catch (error) {
      // Log détaillé pour diagnostic
      if (error.response) {
        logger.debug(`API Error - Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
      } else {
        logger.debug(`Network Error: ${error.message}`);
      }
      throw error;
    }
  }

  async processTransactions(watch, transactions) {
    const { channelId, username, wallet } = watch;
    
    if (!transactions || transactions.length === 0) {
      logger.debug(`Aucune transaction trouvée pour ${username}`);
      return;
    }
    
    // CORRECTION MAJEURE: Gestion des utilisateurs nouvellement ajoutés
    const userKey = `${channelId}_${username}`;
    const isFirstCheck = !this.initializedUsers.has(userKey);
    
    if (isFirstCheck) {
      // Première vérification : initialiser le hash mais ne pas notifier
      logger.info(`🆕 Initialisation de ${username} - définition du hash de référence`);
      this.lastTransactionHashes.set(wallet, transactions[0].hash);
      this.updateLastTransactionHash(channelId, username, transactions[0].hash);
      this.initializedUsers.add(userKey);
      
      // Envoyer une notification de confirmation d'ajout
      await this.sendInitializationNotification(channelId, username, transactions.length);
      return;
    }
    
    // CORRECTION: Utiliser la bonne source pour le hash précédent
    let lastKnownHash = this.lastTransactionHashes.get(wallet);
    if (!lastKnownHash) {
      // Fallback vers les données sauvegardées
      lastKnownHash = watch.lastTransactionHash;
    }
    
    const newTransactions = [];
    
    // CORRECTION: Vérifier que nous avons un hash de référence
    if (!lastKnownHash) {
      logger.warn(`⚠️ Aucun hash de référence pour ${username}, initialisation...`);
      this.lastTransactionHashes.set(wallet, transactions[0].hash);
      this.updateLastTransactionHash(channelId, username, transactions[0].hash);
      return;
    }
    
    // Identifier les nouvelles transactions
    for (const tx of transactions) {
      if (tx.hash === lastKnownHash) {
        logger.debug(`🔍 Hash de référence trouvé pour ${username}: ${lastKnownHash.substring(0, 10)}...`);
        break;
      }
      newTransactions.push(tx);
    }
    
    logger.debug(`📊 ${username}: ${newTransactions.length} nouvelle(s) transaction(s) détectée(s)`);
    
    if (newTransactions.length > 0) {
      // Mettre à jour le cache
      this.lastTransactionHashes.set(wallet, transactions[0].hash);
      this.updateLastTransactionHash(channelId, username, transactions[0].hash);
      
      // Limiter à 3 notifications pour éviter le spam
      const transactionsToNotify = newTransactions.reverse().slice(0, 3);
      
      for (const tx of transactionsToNotify) {
        await this.sendTransactionNotification(channelId, tx, watch);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      if (newTransactions.length > 3) {
        await this.sendBatchNotification(channelId, watch, newTransactions.length - 3);
      }
      
      logger.info(`📊 ${newTransactions.length} nouvelle(s) transaction(s) notifiée(s) pour ${username}`);
    }
  }

  // NOUVELLE MÉTHODE: Notification d'initialisation
  async sendInitializationNotification(channelId, username, transactionCount) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) return;
      
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Surveillance initialisée')
        .setDescription(`**${username}** est maintenant surveillé sur Polygon !`)
        .addFields({
          name: '📊 État actuel',
          value: `${transactionCount} transaction(s) trouvée(s)\nLa surveillance est maintenant active.`
        })
        .addFields({
          name: '🔔 Prochaines étapes',
          value: 'Vous recevrez une notification pour chaque nouvelle transaction.'
        })
        .setFooter({ text: 'Première vérification effectuée • Stalker actif' })
        .setTimestamp();
      
      await channel.send({ embeds: [embed] });
      
    } catch (error) {
      logger.error('Erreur notification initialisation:', error);
    }
  }

  async sendTransactionNotification(channelId, tx, watch) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        logger.warn(`Canal ${channelId} introuvable pour notification stalker`);
        return;
      }
      
      const embed = await this.createTransactionEmbed(tx, watch);
      await channel.send({ embeds: [embed] });
      
      logger.info(`👥 Notification stalker envoyée: ${watch.username} (${tx.hash.substring(0, 10)}...)`);
      
    } catch (error) {
      logger.error('Erreur envoi notification stalker:', error);
    }
  }

  async sendBatchNotification(channelId, watch, additionalCount) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) return;
      
      const embed = new EmbedBuilder()
        .setColor('#FF9800')
        .setTitle('📊 Activité importante détectée')
        .setDescription(`**${watch.username}** a effectué **${additionalCount}** transaction(s) supplémentaire(s)`)
        .addFields({
          name: '⚡ Résumé',
          value: `Utilisateur très actif sur la blockchain.\n[Voir sur PolygonScan](https://polygonscan.com/address/${watch.wallet})`
        })
        .setFooter({ text: 'Notifications groupées pour éviter le spam' })
        .setTimestamp();
      
      await channel.send({ embeds: [embed] });
      
    } catch (error) {
      logger.error('Erreur envoi notification groupée:', error);
    }
  }

  async createTransactionEmbed(tx, watch) {
    const { username, wallet, namespace, tokenId } = watch;
    
    const isIncoming = tx.to && tx.to.toLowerCase() === wallet.toLowerCase();
    const amount = (parseInt(tx.value || '0') / 1e18).toFixed(6);
    const txDate = new Date(parseInt(tx.timeStamp) * 1000);
    
    const embedColor = isIncoming ? '#4CAF50' : '#FF6B6B';
    const typeIcon = isIncoming ? '📥' : '📤';
    const typeText = isIncoming ? 'Réception' : 'Envoi';
    
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`${typeIcon} Transaction Polygon`)
      .setDescription(`**${username}** - ${typeText} de ${amount} MATIC`)
      .addFields(
        {
          name: '👤 Utilisateur',
          value: `**${username}** (${namespace})`,
          inline: true
        },
        {
          name: '💰 Montant',
          value: `${amount} MATIC`,
          inline: true
        },
        {
          name: '📅 Date',
          value: txDate.toLocaleString('fr-FR'),
          inline: true
        },
        {
          name: '🔗 Liens',
          value: `[Transaction](https://polygonscan.com/tx/${tx.hash})\n[Wallet](https://polygonscan.com/address/${wallet})`,
          inline: false
        }
      )
      .setFooter({ 
        text: `Block #${tx.blockNumber || 'N/A'} • Polygon • Stalker` 
      })
      .setTimestamp(txDate);

    return embed;
  }

  updateLastTransactionHash(channelId, username, txHash) {
    try {
      const settings = this.dataManager.getChannelSettings(channelId);
      
      if (settings.stalkerWatching && settings.stalkerWatching[username]) {
        settings.stalkerWatching[username].lastTransactionHash = txHash;
        this.dataManager.setChannelSettings(channelId, settings);
      }
    } catch (error) {
      logger.error('Erreur mise à jour hash transaction:', error);
    }
  }

  // Statistiques améliorées
  getStalkerStats() {
    const watchedUsers = this.getWatchedUsers();
    const uptime = process.uptime();
    
    return {
      watchedUsersCount: watchedUsers.length,
      checkInterval: this.checkInterval / 1000,
      cacheSize: this.lastTransactionHashes.size,
      uniqueChannels: new Set(watchedUsers.map(w => w.channelId)).size,
      uniqueWallets: new Set(watchedUsers.map(w => w.wallet)).size,
      hasApiKey: !!this.API_KEY,
      consecutiveErrors: this.consecutiveErrors,
      stats: {
        ...this.stats,
        successRate: this.stats.totalChecks > 0 ? 
          ((this.stats.successfulChecks / this.stats.totalChecks) * 100).toFixed(1) + '%' : '0%',
        uptime: Math.floor(uptime / 3600) + 'h ' + Math.floor((uptime % 3600) / 60) + 'm'
      }
    };
  }

  async forceCheck() {
    logger.info('🔄 Vérification forcée stalker...');
    this.consecutiveErrors = 0; // Reset les erreurs pour le test
    await this.checkAllWatchedUsers();
  }

  resetStalkerCache() {
    this.lastTransactionHashes.clear();
    this.initializedUsers.clear(); // NOUVEAU
    this.stats = {
      totalChecks: 0,
      successfulChecks: 0,
      apiErrors: 0,
      rateLimitErrors: 0,
      serverErrors: 0
    };
    this.consecutiveErrors = 0;
    logger.info('🔄 Cache et statistiques stalker réinitialisés');
  }

  // Autres méthodes inchangées...
  async stopAllWatchingInChannel(channelId) {
    try {
      const settings = this.dataManager.getChannelSettings(channelId);
      
      if (settings.stalkerWatching) {
        const userCount = Object.keys(settings.stalkerWatching).length;
        
        for (const [username, watchConfig] of Object.entries(settings.stalkerWatching)) {
          this.lastTransactionHashes.delete(watchConfig.wallet);
          // NOUVEAU: Nettoyer aussi les initialisations
          const userKey = `${channelId}_${username}`;
          this.initializedUsers.delete(userKey);
        }
        
        delete settings.stalkerWatching;
        this.dataManager.setChannelSettings(channelId, settings);
        
        logger.info(`🗑️ Toutes les surveillances stalker supprimées du canal ${channelId} (${userCount} utilisateurs)`);
        
        return userCount;
      }
      
      return 0;
    } catch (error) {
      logger.error('Erreur suppression surveillances canal:', error);
      return 0;
    }
  }

  stopWatchingUser(channelId, username) {
    try {
      const settings = this.dataManager.getChannelSettings(channelId);
      
      if (settings.stalkerWatching && settings.stalkerWatching[username]) {
        this.lastTransactionHashes.delete(settings.stalkerWatching[username].wallet);
        
        // NOUVEAU: Nettoyer aussi l'initialisation
        const userKey = `${channelId}_${username}`;
        this.initializedUsers.delete(userKey);
        
        delete settings.stalkerWatching[username];
        
        if (Object.keys(settings.stalkerWatching).length === 0) {
          delete settings.stalkerWatching;
        }
        
        this.dataManager.setChannelSettings(channelId, settings);
        
        logger.info(`🗑️ Surveillance stalker supprimée: ${username} dans canal ${channelId}`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Erreur suppression surveillance utilisateur:', error);
      return false;
    }
  }

  getWatchedUserDetails(channelId, username) {
    try {
      const settings = this.dataManager.getChannelSettings(channelId);
      
      if (settings.stalkerWatching && settings.stalkerWatching[username]) {
        return settings.stalkerWatching[username];
      }
      
      return null;
    } catch (error) {
      logger.error('Erreur récupération détails utilisateur:', error);
      return null;
    }
  }

  debugStalkerWatching() {
    logger.debug('=== STALKER SURVEILLANCE DEBUG ===');
    const watchedUsers = this.getWatchedUsers();
    
    if (watchedUsers.length === 0) {
      logger.debug('Aucune surveillance active');
    } else {
      for (const watch of watchedUsers) {
        const userKey = `${watch.channelId}_${watch.username}`;
        const isInitialized = this.initializedUsers.has(userKey);
        const hasCache = this.lastTransactionHashes.has(watch.wallet);
        
        logger.debug(`Canal ${watch.channelId}: ${watch.username} (${watch.wallet.substring(0, 20)}...)`);
        logger.debug(`  └ Initialisé: ${isInitialized}, Cache: ${hasCache}, Hash sauvé: ${watch.lastTransactionHash ? 'Oui' : 'Non'}`);
      }
    }
    
    logger.debug(`Intervalle actuel: ${this.checkInterval/1000}s`);
    logger.debug(`Erreurs consécutives: ${this.consecutiveErrors}`);
    logger.debug(`Cache size: ${this.lastTransactionHashes.size}`);
    logger.debug(`Utilisateurs initialisés: ${this.initializedUsers.size}`);
    logger.debug(`API Key configurée: ${!!this.API_KEY}`);
    logger.debug(`Statistiques: ${JSON.stringify(this.stats, null, 2)}`);
    logger.debug('=== FIN DEBUG STALKER ===');
  }

  async cleanupOrphanedWatches() {
    let cleanupCount = 0;
    
    try {
      const watchedUsers = this.getWatchedUsers();
      
      for (const watch of watchedUsers) {
        const channel = this.client.channels.cache.get(watch.channelId);
        
        if (!channel) {
          this.stopWatchingUser(watch.channelId, watch.username);
          cleanupCount++;
          logger.info(`🧹 Surveillance orpheline nettoyée: ${watch.username} (canal ${watch.channelId} supprimé)`);
        }
      }
      
      if (cleanupCount > 0) {
        await this.dataManager.save();
        logger.info(`🧹 Nettoyage terminé: ${cleanupCount} surveillance(s) orpheline(s) supprimée(s)`);
      }
      
    } catch (error) {
      logger.error('Erreur nettoyage surveillances orphelines:', error);
    }
    
    return cleanupCount;
  }
}

module.exports = PolygonStalkerService;
