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
    
    // Proxies CORS mis à jour et plus fiables
    this.CORS_PROXIES = [
      'https://api.allorigins.win/raw?url=',
      'https://api.codetabs.com/v1/proxy?quest=',
      'https://corsproxy.io/?',
      'https://proxy.cors.sh/',
      'https://api.cors.lol/?url='
    ];
    
    // Intervalle de vérification (45 secondes pour éviter le rate limiting)
    this.checkInterval = 45 * 1000;
    
    // Cache des dernières transactions pour éviter les doublons
    this.lastTransactionHashes = new Map();
    
    this.startWatching();
  }

  startWatching() {
    // Vérification initiale après 2 minutes (laisser le bot se stabiliser)
    setTimeout(() => {
      this.checkAllWatchedUsers();
    }, 120000);
    
    // Puis vérification toutes les 45 secondes
    setInterval(() => {
      this.checkAllWatchedUsers();
    }, this.checkInterval);
    
    logger.info(`👥 Service Polygon Stalker démarré (vérification toutes les ${this.checkInterval/1000}s)`);
    
    if (this.API_KEY) {
      logger.info('🔑 API Key PolygonScan configurée - Rate limit: 5/sec, 100k/jour');
    } else {
      logger.warn('⚠️ Aucune API Key PolygonScan - Rate limit réduit (1/5sec)');
    }
  }

  async checkAllWatchedUsers() {
    try {
      const watchedUsers = this.getWatchedUsers();
      
      if (watchedUsers.length === 0) {
        return;
      }
      
      logger.debug(`👥 Vérification Stalker pour ${watchedUsers.length} utilisateur(s) surveillé(s)`);
      
      for (const watch of watchedUsers) {
        try {
          await this.checkUserTransactions(watch);
          // Attendre entre chaque vérification pour respecter le rate limit
          const delay = this.API_KEY ? 250 : 1200; // 4/sec avec API key, 1/sec sans
          await new Promise(resolve => setTimeout(resolve, delay));
        } catch (error) {
          logger.error(`Erreur surveillance ${watch.username}:`, error.message);
        }
      }
      
    } catch (error) {
      logger.error('Erreur surveillance Stalker globale:', error);
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
    
    try {
      // Construire l'URL avec ou sans API key
      let apiUrl = `${this.POLYGONSCAN_API_URL}?module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=10&sort=desc`;
      
      if (this.API_KEY) {
        apiUrl += `&apikey=${this.API_KEY}`;
      }
      
      let data = null;
      
      // 1. Essayer d'abord l'API directe
      if (this.API_KEY) {
        try {
          logger.debug(`🔑 Tentative API directe avec clé pour ${username}`);
          const response = await axios.get(apiUrl, {
            timeout: 10000,
            headers: {
              'User-Agent': 'SoccerverseBot/3.0',
              'Accept': 'application/json'
            }
          });
          
          if (response.status === 200 && response.data) {
            data = response.data;
            logger.debug(`✅ API directe réussie pour ${username}`);
          }
        } catch (error) {
          logger.warn(`⚠️ API directe échouée pour ${username}: ${error.message}`);
        }
      }
      
      // 2. Si l'API directe échoue, essayer les proxies
      if (!data) {
        for (let i = 0; i < this.CORS_PROXIES.length && !data; i++) {
          const proxy = this.CORS_PROXIES[i];
          try {
            logger.debug(`🔄 Proxy ${i + 1}/${this.CORS_PROXIES.length} pour ${username}`);
            
            const response = await axios.get(proxy + encodeURIComponent(apiUrl), {
              timeout: 15000,
              headers: {
                'User-Agent': 'SoccerverseBot/3.0',
                'Accept': 'application/json'
              }
            });
            
            if (response.status === 200) {
              try {
                data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                logger.debug(`✅ Proxy ${i + 1} réussi pour ${username}`);
                break;
              } catch (parseError) {
                logger.debug(`❌ Proxy ${i + 1} - Parsing échoué pour ${username}`);
              }
            }
          } catch (error) {
            logger.debug(`❌ Proxy ${i + 1} échoué pour ${username}: ${error.message}`);
            continue;
          }
        }
      }
      
      if (!data || data.status !== '1' || !data.result || !Array.isArray(data.result)) {
        logger.warn(`⚠️ Aucune donnée valide pour ${username}`);
        return;
      }
      
      // Traitement des transactions
      const lastKnownHash = this.lastTransactionHashes.get(wallet) || watch.lastTransactionHash;
      const newTransactions = [];
      
      for (const tx of data.result) {
        if (tx.hash === lastKnownHash) break;
        newTransactions.push(tx);
      }
      
      if (newTransactions.length > 0) {
        // Mettre à jour le cache
        this.lastTransactionHashes.set(wallet, data.result[0].hash);
        
        // Mettre à jour la configuration persistante
        this.updateLastTransactionHash(channelId, username, data.result[0].hash);
        
        // Notifier les nouvelles transactions (max 3 pour éviter le spam)
        const transactionsToNotify = newTransactions.reverse().slice(0, 3);
        
        for (const tx of transactionsToNotify) {
          await this.sendTransactionNotification(channelId, tx, watch);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (newTransactions.length > 3) {
          await this.sendBatchNotification(channelId, watch, newTransactions.length - 3);
        }
      }
      
    } catch (error) {
      logger.error(`Erreur vérification transactions ${username}:`, error.message);
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
      
      logger.info(`👥 Notification stalker envoyée: ${watch.username} (${tx.hash.substring(0, 20)}...)`);
      
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
          value: `Utilisateur très actif sur la blockchain.\nConsultez [PolygonScan](https://polygonscan.com/address/${watch.wallet}) pour plus de détails.`
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
    
    const isIncoming = tx.to.toLowerCase() === wallet.toLowerCase();
    const amount = (parseInt(tx.value) / 1e18).toFixed(6);
    const gasUsed = parseInt(tx.gasUsed).toLocaleString();
    const gasCost = (parseInt(tx.gasUsed) * parseInt(tx.gasPrice) / 1e18).toFixed(6);
    
    const embedColor = isIncoming ? '#4CAF50' : '#FF6B6B';
    const typeIcon = isIncoming ? '📥' : '📤';
    const typeText = isIncoming ? 'Réception' : 'Envoi';
    
    const txDate = new Date(parseInt(tx.timeStamp) * 1000);
    
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`${typeIcon} Transaction Polygon détectée !`)
      .setDescription(`**${username}** vient d'effectuer une transaction`)
      .addFields(
        {
          name: '👤 Utilisateur surveillé',
          value: `**${username}**\n🏷️ Namespace: ${namespace}\n🔢 Token ID: ${tokenId}`,
          inline: true
        },
        {
          name: '📊 Type de transaction',
          value: `${typeIcon} **${typeText}**\n💰 **${amount} MATIC**\n⛽ Gas: ${gasCost} MATIC`,
          inline: true
        },
        {
          name: '📅 Timestamp',
          value: `${txDate.toLocaleDateString('fr-FR')}\n${txDate.toLocaleTimeString('fr-FR')}`,
          inline: true
        },
        {
          name: '🔗 Liens',
          value: `[Hash: ${tx.hash.substring(0, 20)}...](https://polygonscan.com/tx/${tx.hash})\n[Wallet sur PolygonScan](https://polygonscan.com/address/${wallet})`,
          inline: false
        }
      );

    // Ajouter des détails pour les interactions avec contrats
    if (tx.input !== '0x' && tx.input.length > 10) {
      embed.addFields({
        name: '🤖 Interaction avec contrat',
        value: `**Contrat:** \`${tx.to}\`\nDonnées: \`${tx.input.substring(0, 20)}...\`\nGas utilisé: ${gasUsed}`,
        inline: false
      });
    }

    // Indicateur pour les transactions importantes
    if (parseFloat(amount) > 1.0) {
      embed.addFields({
        name: '💎 Transaction importante',
        value: `⚠️ Cette transaction implique **${amount} MATIC** !`,
        inline: false
      });
    }

    embed.setFooter({ 
      text: `Réseau: Polygon • Surveillé par Stalker • Block #${tx.blockNumber}` 
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

  // Méthodes de gestion (inchangées)
  getStalkerStats() {
    const watchedUsers = this.getWatchedUsers();
    
    return {
      watchedUsersCount: watchedUsers.length,
      checkInterval: this.checkInterval / 1000,
      cacheSize: this.lastTransactionHashes.size,
      uniqueChannels: new Set(watchedUsers.map(w => w.channelId)).size,
      uniqueWallets: new Set(watchedUsers.map(w => w.wallet)).size,
      hasApiKey: !!this.API_KEY
    };
  }

  async forceCheck() {
    logger.info('🔄 Vérification forcée stalker...');
    await this.checkAllWatchedUsers();
  }

  resetStalkerCache() {
    this.lastTransactionHashes.clear();
    logger.info('🔄 Cache stalker réinitialisé');
  }

  async stopAllWatchingInChannel(channelId) {
    try {
      const settings = this.dataManager.getChannelSettings(channelId);
      
      if (settings.stalkerWatching) {
        const userCount = Object.keys(settings.stalkerWatching).length;
        
        for (const [username, watchConfig] of Object.entries(settings.stalkerWatching)) {
          this.lastTransactionHashes.delete(watchConfig.wallet);
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
        logger.debug(`Canal ${watch.channelId}: ${watch.username} (${watch.wallet.substring(0, 20)}...)`);
      }
    }
    
    logger.debug(`Cache size: ${this.lastTransactionHashes.size}`);
    logger.debug(`API Key configurée: ${!!this.API_KEY}`);
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

module.exports = PolygonStalkerService;
