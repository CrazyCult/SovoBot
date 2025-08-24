const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

class PolygonStalkerService {
  constructor(client, dataManager, apiClient) {
    this.client = client;
    this.dataManager = dataManager;
    this.apiClient = apiClient;
    
    // Cache des dernières transactions pour chaque utilisateur
    this.lastTransactions = new Map();
    
    // Intervalle de vérification (60 secondes)
    this.checkInterval = 60 * 1000;
    
    // Flag pour éviter les notifications lors de la première vérification
    this.initializedUsers = new Set();
    
    // Compteurs pour monitoring
    this.stats = {
      totalChecks: 0,
      successfulChecks: 0,
      apiErrors: 0,
      notificationsSent: 0
    };
    
    this.startWatching();
  }

  startWatching() {
    // Vérification initiale après 2 minutes
    setTimeout(() => {
      this.checkAllWatchedUsers();
    }, 120000);
    
    // Puis vérification toutes les 60 secondes
    setInterval(() => {
      this.checkAllWatchedUsers();
    }, this.checkInterval);
    
    logger.info('👥 Service Stalker Soccerverse démarré (vérification toutes les 60 secondes)');
  }

  async checkAllWatchedUsers() {
    try {
      const watchedUsers = this.getWatchedUsers();
      
      if (watchedUsers.length === 0) {
        return;
      }
      
      logger.debug(`👥 Vérification stalker pour ${watchedUsers.length} utilisateur(s)`);
      this.stats.totalChecks++;
      
      for (const watch of watchedUsers) {
        try {
          await this.checkUserTransactions(watch);
          this.stats.successfulChecks++;
          
          // Attendre 2 secondes entre chaque utilisateur pour éviter de surcharger l'API
          await new Promise(resolve => setTimeout(resolve, 2000));
          
        } catch (error) {
          this.stats.apiErrors++;
          logger.error(`Erreur surveillance ${watch.username}:`, error);
        }
      }
      
    } catch (error) {
      logger.error('Erreur surveillance stalker globale:', error);
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
            addedAt: watchConfig.addedAt,
            lastTransactionId: watchConfig.lastTransactionId
          });
        }
      }
    }
    
    return watched;
  }

  async checkUserTransactions(watch) {
    const { channelId, username } = watch;
    
    try {
      // Récupérer les transactions de l'utilisateur via l'API Soccerverse
      const result = await this.apiClient.makeRpcRequest('get_user_share_transactions', {
        name: username
      });
      
      let transactions = [];
      
      // Traiter le résultat selon sa structure
      if (Array.isArray(result)) {
        transactions = result;
      } else if (result && Array.isArray(result.data)) {
        transactions = result.data;
      } else if (result && result.result && Array.isArray(result.result)) {
        transactions = result.result;
      }
      
      if (transactions.length === 0) {
        logger.debug(`Aucune transaction trouvée pour ${username}`);
        return;
      }
      
      // Trier les transactions par date (plus récent en premier)
      transactions.sort((a, b) => (b.date || 0) - (a.date || 0));
      
      // Gestion de la première vérification
      const userKey = `${channelId}_${username}`;
      const isFirstCheck = !this.initializedUsers.has(userKey);
      
      if (isFirstCheck) {
        // Première vérification : initialiser sans notifier
        logger.info(`🆕 Initialisation stalker pour ${username} - ${transactions.length} transaction(s) trouvée(s)`);
        
        if (transactions.length > 0) {
          const latestTx = transactions[0];
          const latestTxId = this.getTransactionId(latestTx);
          this.lastTransactions.set(username, latestTxId);
          this.updateLastTransactionId(channelId, username, latestTxId);
        }
        
        this.initializedUsers.add(userKey);
        
        // Envoyer notification d'initialisation
        await this.sendInitializationNotification(channelId, username, transactions.length);
        return;
      }
      
      // Détecter les nouvelles transactions
      const lastKnownId = this.lastTransactions.get(username) || watch.lastTransactionId;
      const newTransactions = [];
      
      for (const tx of transactions) {
        const txId = this.getTransactionId(tx);
        
        if (lastKnownId && txId === lastKnownId) {
          break; // On a atteint la dernière transaction connue
        }
        
        newTransactions.push(tx);
      }
      
      logger.debug(`📊 ${username}: ${newTransactions.length} nouvelle(s) transaction(s) détectée(s)`);
      
      if (newTransactions.length > 0) {
        // Mettre à jour le cache
        const latestTx = transactions[0];
        const latestTxId = this.getTransactionId(latestTx);
        this.lastTransactions.set(username, latestTxId);
        this.updateLastTransactionId(channelId, username, latestTxId);
        
        // Limiter à 3 notifications pour éviter le spam
        const transactionsToNotify = newTransactions.reverse().slice(0, 3);
        
        for (const tx of transactionsToNotify) {
          await this.sendTransactionNotification(channelId, tx, watch);
          this.stats.notificationsSent++;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (newTransactions.length > 3) {
          await this.sendBatchNotification(channelId, watch, newTransactions.length - 3);
        }
        
        logger.info(`📊 ${newTransactions.length} nouvelle(s) transaction(s) notifiée(s) pour ${username}`);
      }
      
    } catch (error) {
      logger.error(`Erreur vérification transactions ${username}:`, error);
      throw error;
    }
  }

  getTransactionId(tx) {
    // Créer un ID unique basé sur plusieurs champs pour éviter les doublons
    if (tx.date && tx.num && tx.type) {
      return `${tx.date}_${tx.num}_${tx.type}`;
    } else if (tx.date && tx.type) {
      return `${tx.date}_${tx.type}`;
    } else {
      return `${tx.date || Date.now()}_${Math.random().toString(36).substring(7)}`;
    }
  }

  async sendInitializationNotification(channelId, username, transactionCount) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) return;
      
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Surveillance Stalker initialisée')
        .setDescription(`**${username}** est maintenant surveillé !`)
        .addFields({
          name: '📊 État actuel',
          value: `${transactionCount} transaction(s) d'historique trouvée(s)\nLa surveillance est maintenant active.`
        })
        .addFields({
          name: '🔔 Prochaines étapes',
          value: 'Vous recevrez une notification pour chaque nouvelle transaction de parts, mint NFT, ou autre activité.'
        })
        .setFooter({ text: 'Première vérification effectuée • Stalker actif' })
        .setTimestamp();
      
      await channel.send({ embeds: [embed] });
      
    } catch (error) {
      logger.error('Erreur notification initialisation stalker:', error);
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
      
      logger.info(`👥 Notification stalker envoyée: ${watch.username} (${tx.type})`);
      
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
          value: `Utilisateur très actif sur Soccerverse.\n[Voir le profil](https://play.soccerverse.com/user/${watch.username})`
        })
        .setFooter({ text: 'Notifications groupées pour éviter le spam' })
        .setTimestamp();
      
      await channel.send({ embeds: [embed] });
      
    } catch (error) {
      logger.error('Erreur envoi notification groupée stalker:', error);
    }
  }

  async createTransactionEmbed(tx, watch) {
    const { username } = watch;
    
    const txDate = tx.date ? new Date(tx.date * 1000) : new Date();
    const type = tx.type || 'Transaction inconnue';
    const num = tx.num || 'N/A';
    const otherName = tx.othername || 'N/A'; // CORRECTION: "othername" pas "other_name"
    
    // Déterminer le type de transaction et la couleur
    let embedColor = '#2196F3';
    let typeIcon = '💼';
    let typeText = 'Transaction';
    let detailsText = '';
    let linksText = `[Profil utilisateur](https://play.soccerverse.com/user/${username})`;
    
    // CORRECTION: Nouvelle structure share
    const shareObj = tx.share || {};
    let shareType = 'N/A';
    let shareId = 'N/A';
    let shareName = 'N/A';
    
    if (shareObj.club) {
      shareType = 'club';
      shareId = shareObj.club;
      try {
        shareName = this.apiClient.getClubName(parseInt(shareId));
      } catch (e) {
        shareName = `Club #${shareId}`;
      }
    } else if (shareObj.player) {
      shareType = 'player';
      shareId = shareObj.player;
      try {
        shareName = this.apiClient.getPlayerName(parseInt(shareId));
      } catch (e) {
        shareName = `Joueur #${shareId}`;
      }
    }
    
    if (type.includes('share trade')) {
      embedColor = '#9C27B0';
      typeIcon = '💹';
      typeText = 'Transaction de Parts';
      
      detailsText = `**Type:** ${shareType}\n**ID:** ${shareId}\n**Nom:** ${shareName}`;
      
      if (shareType === 'club') {
        linksText += `\n[${shareName}](https://play.soccerverse.com/club/${shareId})`;
      } else if (shareType === 'player') {
        linksText += `\n[${shareName}](https://play.soccerverse.com/player/${shareId})`;
      }
      
      if (otherName !== 'N/A') {
        detailsText += `\n**Partenaire:** [${otherName}](https://play.soccerverse.com/user/${otherName})`;
      }
      
    } else if (type.includes('mint')) {
      embedColor = '#4CAF50';
      typeIcon = '🎨';
      typeText = 'Mint NFT';
      detailsText = `**Montant:** ${num}\n**Type:** Création de carte NFT`;
      
      // Pour les mints, on a maintenant les vraies infos !
      if (shareType === 'club') {
        detailsText += `\n**Club:** ${shareName}`;
        linksText += `\n[${shareName}](https://play.soccerverse.com/club/${shareId})`;
      } else if (shareType === 'player') {
        detailsText += `\n**Joueur:** ${shareName}`;
        linksText += `\n[${shareName}](https://play.soccerverse.com/player/${shareId})`;
      }
      
    } else if (type.includes('user tx')) {
      embedColor = '#FF6B6B';
      typeIcon = '💸';
      typeText = 'Transaction Utilisateur';
      detailsText = `**Numéro:** ${num}`;
      
      if (otherName !== 'N/A') {
        detailsText += `\n**Destinataire:** [${otherName}](https://play.soccerverse.com/user/${otherName})`;
      }
    }
    
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`${typeIcon} ${typeText}`)
      .setDescription(`**${username}** a effectué une nouvelle transaction`)
      .addFields(
        {
          name: '👤 Utilisateur',
          value: username,
          inline: true
        },
        {
          name: '📅 Date',
          value: txDate.toLocaleString('fr-FR'),
          inline: true
        },
        {
          name: '🏷️ Type',
          value: type,
          inline: true
        }
      );

    if (detailsText) {
      embed.addFields({
        name: '📋 Détails',
        value: detailsText,
        inline: false
      });
    }

    embed.addFields({
      name: '🔗 Liens',
      value: linksText,
      inline: false
    });

    embed.setFooter({ 
      text: `Transaction #${num} • Soccerverse Stalker` 
    })
    .setTimestamp(txDate);

    return embed;
  }

  updateLastTransactionId(channelId, username, txId) {
    try {
      const settings = this.dataManager.getChannelSettings(channelId);
      
      if (settings.stalkerWatching && settings.stalkerWatching[username]) {
        settings.stalkerWatching[username].lastTransactionId = txId;
        this.dataManager.setChannelSettings(channelId, settings);
      }
    } catch (error) {
      logger.error('Erreur mise à jour ID transaction:', error);
    }
  }

  // =================== MÉTHODES DE GESTION ===================

  async stopAllWatchingInChannel(channelId) {
    try {
      const settings = this.dataManager.getChannelSettings(channelId);
      
      if (settings.stalkerWatching) {
        const userCount = Object.keys(settings.stalkerWatching).length;
        
        for (const [username, watchConfig] of Object.entries(settings.stalkerWatching)) {
          this.lastTransactions.delete(username);
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
        this.lastTransactions.delete(username);
        
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

  // =================== MÉTHODES UTILITAIRES ===================

  getStalkerStats() {
    const watchedUsers = this.getWatchedUsers();
    const uptime = process.uptime();
    
    return {
      watchedUsersCount: watchedUsers.length,
      checkInterval: this.checkInterval / 1000,
      cacheSize: this.lastTransactions.size,
      uniqueChannels: new Set(watchedUsers.map(w => w.channelId)).size,
      uniqueUsers: new Set(watchedUsers.map(w => w.username)).size,
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
    await this.checkAllWatchedUsers();
  }

  resetStalkerCache() {
    this.lastTransactions.clear();
    this.initializedUsers.clear();
    this.stats = {
      totalChecks: 0,
      successfulChecks: 0,
      apiErrors: 0,
      notificationsSent: 0
    };
    logger.info('🔄 Cache et statistiques stalker réinitialisés');
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
        const hasCache = this.lastTransactions.has(watch.username);
        
        logger.debug(`Canal ${watch.channelId}: ${watch.username}`);
        logger.debug(`  └ Initialisé: ${isInitialized}, Cache: ${hasCache}, ID sauvé: ${watch.lastTransactionId ? 'Oui' : 'Non'}`);
      }
    }
    
    logger.debug(`Intervalle actuel: ${this.checkInterval/1000}s`);
    logger.debug(`Cache size: ${this.lastTransactions.size}`);
    logger.debug(`Utilisateurs initialisés: ${this.initializedUsers.size}`);
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

  // =================== MÉTHODES POUR TESTS ===================

  async testUserExists(username) {
    try {
      const result = await this.apiClient.makeRpcRequest('get_user_share_transactions', {
        name: username
      });
      
      // Si on reçoit une réponse (même vide), l'utilisateur existe
      return result !== null && result !== undefined;
      
    } catch (error) {
      // Si l'API retourne une erreur, l'utilisateur n'existe probablement pas
      return false;
    }
  }

  async getUserTransactionSample(username, limit = 5) {
    try {
      const result = await this.apiClient.makeRpcRequest('get_user_share_transactions', {
        name: username
      });
      
      let transactions = [];
      
      if (Array.isArray(result)) {
        transactions = result;
      } else if (result && Array.isArray(result.data)) {
        transactions = result.data;
      }
      
      return transactions.slice(0, limit);
      
    } catch (error) {
      logger.error(`Erreur récupération échantillon ${username}:`, error);
      return [];
    }
  }
}

module.exports = PolygonStalkerService;
