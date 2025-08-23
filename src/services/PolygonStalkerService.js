const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../utils/logger');

class PolygonStalkerService {
  constructor(client, dataManager) {
    this.client = client;
    this.dataManager = dataManager;
    
    // Configuration PolygonScan API
    this.POLYGONSCAN_API_URL = 'https://api.polygonscan.com/api';
    this.CORS_PROXY = 'https://api.allorigins.win/raw?url=';
    
    // Intervalle de vérification (30 secondes)
    this.checkInterval = 30 * 1000;
    
    // Cache des dernières transactions pour éviter les doublons
    this.lastTransactionHashes = new Map();
    
    this.startWatching();
  }

  startWatching() {
    // Vérification initiale après 1 minute
    setTimeout(() => {
      this.checkAllWatchedUsers();
    }, 60000);
    
    // Puis vérification toutes les 30 secondes
    setInterval(() => {
      this.checkAllWatchedUsers();
    }, this.checkInterval);
    
    logger.info('👥 Service Polygon Stalker démarré (vérification toutes les 30 secondes)');
  }

  async checkAllWatchedUsers() {
    try {
      // Récupérer tous les canaux avec surveillance active
      const watchedUsers = this.getWatchedUsers();
      
      if (watchedUsers.length === 0) {
        return;
      }
      
      logger.debug(`👥 Vérification Stalker pour ${watchedUsers.length} utilisateur(s) surveillé(s)`);
      
      for (const watch of watchedUsers) {
        try {
          await this.checkUserTransactions(watch);
          // Attendre 1 seconde entre chaque vérification pour éviter le rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error(`Erreur surveillance ${watch.username}:`, error);
        }
      }
      
    } catch (error) {
      logger.error('Erreur surveillance Stalker globale:', error);
    }
  }

  getWatchedUsers() {
    const watched = [];
    
    // Parcourir tous les canaux avec des paramètres de surveillance stalker
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
      // Construire l'URL de l'API PolygonScan
      const targetUrl = `${this.POLYGONSCAN_API_URL}?module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=5&sort=desc`;
      const proxyUrl = this.CORS_PROXY + encodeURIComponent(targetUrl);
      
      const response = await axios.get(proxyUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'SoccerverseBot/3.0',
          'Accept': 'application/json'
        }
      });
      
      const data = response.data;
      
      if (data.status === '1' && data.result && data.result.length > 0) {
        const lastKnownHash = this.lastTransactionHashes.get(wallet) || watch.lastTransactionHash;
        const newTransactions = [];
        
        // Collecter les nouvelles transactions
        for (const tx of data.result) {
          if (tx.hash === lastKnownHash) break;
          newTransactions.push(tx);
        }
        
        // Si de nouvelles transactions sont trouvées
        if (newTransactions.length > 0) {
          // Mettre à jour le cache
          this.lastTransactionHashes.set(wallet, data.result[0].hash);
          
          // Mettre à jour la configuration persistante
          this.updateLastTransactionHash(channelId, username, data.result[0].hash);
          
          // Notifier les nouvelles transactions (en ordre chronologique)
          for (const tx of newTransactions.reverse()) {
            await this.sendTransactionNotification(channelId, tx, watch);
            // Attendre un peu entre chaque notification
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }
      
    } catch (error) {
      logger.error(`Erreur vérification transactions ${username}:`, error);
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

  async createTransactionEmbed(tx, watch) {
    const { username, wallet, namespace, tokenId } = watch;
    
    // Déterminer si c'est une transaction entrante ou sortante
    const isIncoming = tx.to.toLowerCase() === wallet.toLowerCase();
    const amount = (parseInt(tx.value) / 1e18).toFixed(6);
    const gasUsed = parseInt(tx.gasUsed).toLocaleString();
    const gasCost = (parseInt(tx.gasUsed) * parseInt(tx.gasPrice) / 1e18).toFixed(6);
    
    // Couleur selon le type de transaction
    const embedColor = isIncoming ? '#4CAF50' : '#FF6B6B'; // Vert pour réception, rouge pour envoi
    const typeIcon = isIncoming ? '📥' : '📤';
    const typeText = isIncoming ? 'Réception' : 'Envoi';
    
    // Date de la transaction
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
          name: '🔗 Hash de transaction',
          value: `\`${tx.hash}\`\n[Voir sur PolygonScan](https://polygonscan.com/tx/${tx.hash})`,
          inline: false
        },
        {
          name: '📍 Détails des adresses',
          value: 
            `**De:** \`${tx.from}\`\n` +
            `**Vers:** \`${tx.to}\`\n` +
            `**Contrat:** ${tx.to === tx.from ? 'N/A' : (tx.input !== '0x' ? 'Oui' : 'Non')}`,
          inline: false
        }
      );

    // Ajouter des détails spéciaux pour les contrats intelligents
    if (tx.input !== '0x') {
      embed.addFields({
        name: '🤖 Interaction avec contrat',
        value: `Données: ${tx.input.substring(0, 20)}...\nGas utilisé: ${gasUsed}`,
        inline: true
      });
    }

    // Ajouter un indicateur de valeur
    if (parseFloat(amount) > 0.1) {
      embed.addFields({
        name: '💎 Transaction importante',
        value: `Cette transaction implique **${amount} MATIC** !`,
        inline: false
      });
    }

    embed.setFooter({ 
      text: `Réseau: Polygon • Surveillé par Stalker • ${txDate.toISOString()}` 
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
        // Note: La sauvegarde sera faite par le processus principal
      }
    } catch (error) {
      logger.error('Erreur mise à jour hash transaction:', error);
    }
  }

  // Méthodes de gestion pour les commandes

  getStalkerStats() {
    const watchedUsers = this.getWatchedUsers();
    
    return {
      watchedUsersCount: watchedUsers.length,
      checkInterval: this.checkInterval / 1000, // en secondes
      cacheSize: this.lastTransactionHashes.size,
      uniqueChannels: new Set(watchedUsers.map(w => w.channelId)).size,
      uniqueWallets: new Set(watchedUsers.map(w => w.wallet)).size
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

  // Arrêter toutes les surveillances d'un canal
  async stopAllWatchingInChannel(channelId) {
    try {
      const settings = this.dataManager.getChannelSettings(channelId);
      
      if (settings.stalkerWatching) {
        const userCount = Object.keys(settings.stalkerWatching).length;
        
        // Supprimer les caches correspondants
        for (const [username, watchConfig] of Object.entries(settings.stalkerWatching)) {
          this.lastTransactionHashes.delete(watchConfig.wallet);
        }
        
        // Supprimer la configuration
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

  // Arrêter la surveillance d'un utilisateur spécifique
  stopWatchingUser(channelId, username) {
    try {
      const settings = this.dataManager.getChannelSettings(channelId);
      
      if (settings.stalkerWatching && settings.stalkerWatching[username]) {
        // Supprimer du cache
        this.lastTransactionHashes.delete(settings.stalkerWatching[username].wallet);
        
        // Supprimer de la configuration
        delete settings.stalkerWatching[username];
        
        // Si plus aucun utilisateur surveillé, supprimer la section
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

  // Méthode pour obtenir les détails d'un utilisateur surveillé
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

  // Debug: Afficher toutes les surveillances actives
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
    logger.debug('=== FIN DEBUG STALKER ===');
  }

  // Méthode pour nettoyer les surveillances orphelines (canaux supprimés)
  async cleanupOrphanedWatches() {
    let cleanupCount = 0;
    
    try {
      const watchedUsers = this.getWatchedUsers();
      
      for (const watch of watchedUsers) {
        const channel = this.client.channels.cache.get(watch.channelId);
        
        if (!channel) {
          // Canal supprimé, nettoyer la surveillance
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
