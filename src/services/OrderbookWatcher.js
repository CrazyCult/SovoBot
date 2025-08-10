const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

class OrderbookWatcher {
  constructor(client, dataManager, apiClient) {
    this.client = client;
    this.dataManager = dataManager;
    this.apiClient = apiClient;
    
    // Cache des derniers ordres vus pour chaque club
    this.lastSeenOrders = new Map();
    
    // Intervalle de vérification (1 minute)
    this.checkInterval = 1 * 60 * 1000;
    
    // Démarrer la surveillance
    this.startWatching();
  }

  startWatching() {
    // Vérification initiale après 30 secondes
    setTimeout(() => {
      this.checkAllWatchedClubs();
    }, 30000);
    
    // Puis vérification toutes les 1 minute
    setInterval(() => {
      this.checkAllWatchedClubs();
    }, this.checkInterval);
    
    logger.info('🔍 Surveillance orderbook démarrée (vérification toutes les 1 minute)');
  }

  async checkAllWatchedClubs() {
    try {
      // Récupérer tous les canaux avec surveillance orderbook activée
      const watchedClubs = this.getWatchedClubs();
      
      if (watchedClubs.length === 0) {
        return;
      }
      
      logger.debug(`🔍 Vérification orderbook pour ${watchedClubs.length} surveillance(s)`);
      
      for (const watch of watchedClubs) {
        try {
          await this.checkClubOrders(watch);
          // Attendre 1 seconde entre chaque vérification pour éviter de surcharger l'API
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error(`Erreur surveillance club ${watch.clubId}:`, error);
        }
      }
      
    } catch (error) {
      logger.error('Erreur surveillance orderbook globale:', error);
    }
  }

  getWatchedClubs() {
    const watched = [];
    
    // Parcourir tous les canaux avec des paramètres de surveillance
    for (const [channelId, registrations] of this.dataManager.data.registrations.entries()) {
      const settings = this.dataManager.getChannelSettings(channelId);
      
      if (settings.orderbookWatching) {
        for (const [clubId, watchConfig] of Object.entries(settings.orderbookWatching)) {
          if (watchConfig.enabled) {
            watched.push({
              channelId,
              clubId: parseInt(clubId),
              minPrice: watchConfig.minPrice,
              maxPrice: watchConfig.maxPrice
            });
          }
        }
      }
    }
    
    return watched;
  }

  async checkClubOrders(watch) {
    const { channelId, clubId, minPrice, maxPrice } = watch;
    
    try {
      // Récupérer l'orderbook actuel
      const orderbook = await this.fetchClubOrderbook(clubId);
      
      if (!orderbook) {
        return;
      }
      
      // Obtenir les derniers ordres vus pour ce club
      const lastSeen = this.lastSeenOrders.get(clubId) || { buyOrders: [], sellOrders: [] };
      
      // Détecter les nouveaux ordres
      const newBuyOrders = this.findNewOrders(orderbook.buyOrders, lastSeen.buyOrders, minPrice, maxPrice);
      const newSellOrders = this.findNewOrders(orderbook.sellOrders, lastSeen.sellOrders, minPrice, maxPrice);
      
      // Envoyer notifications si nouveaux ordres
      if (newBuyOrders.length > 0 || newSellOrders.length > 0) {
        await this.sendOrderNotification(channelId, clubId, newBuyOrders, newSellOrders, minPrice, maxPrice);
      }
      
      // Mettre à jour le cache
      this.lastSeenOrders.set(clubId, orderbook);
      
    } catch (error) {
      logger.error(`Erreur vérification club ${clubId}:`, error);
    }
  }

  findNewOrders(currentOrders, lastOrders, minPrice, maxPrice) {
    const lastOrderIds = new Set(lastOrders.map(order => order.orderId));
    
    return currentOrders.filter(order => {
      // Vérifier si c'est un nouvel ordre
      if (lastOrderIds.has(order.orderId)) {
        return false;
      }
      
      // Vérifier les critères de prix
      if (minPrice !== undefined && order.price < minPrice) {
        return false;
      }
      
      if (maxPrice !== undefined && order.price > maxPrice) {
        return false;
      }
      
      return true;
    });
  }

  async sendOrderNotification(channelId, clubId, newBuyOrders, newSellOrders, minPrice, maxPrice) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        logger.warn(`Canal ${channelId} introuvable pour notification orderbook`);
        return;
      }
      
      // Récupérer les infos du club
      let clubName = this.apiClient.getClubName(clubId);
      
      // Créer l'embed de notification
      const embed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle('🚨 Nouveaux Ordres Détectés!')
        .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`)
        .setDescription(`**${clubName}** (#${clubId})`)
        .setTimestamp();

      // Ajouter les critères de surveillance
      let filterText = '';
      if (minPrice !== undefined) filterText += `Min: ${(minPrice / 10000).toLocaleString()}$ `;
      if (maxPrice !== undefined) filterText += `Max: ${(maxPrice / 10000).toLocaleString()}$`;
      
      if (filterText) {
        embed.addFields({
          name: '🔍 Critères de surveillance',
          value: filterText.trim(),
          inline: false
        });
      }

      // Ajouter les nouveaux ordres d'achat
      if (newBuyOrders.length > 0) {
        const buyOrdersText = newBuyOrders
          .slice(0, 5) // Limiter à 5 ordres
          .map(order => {
            const price = (order.price / 10000).toLocaleString('fr-FR');
            return `**${order.username || 'Utilisateur supprimé'}**\n└ ${price}$ • ${order.shares} parts • #${order.orderId}`;
          })
          .join('\n\n');

        embed.addFields({
          name: `📈 Nouveaux Ordres d'Achat (${newBuyOrders.length})`,
          value: buyOrdersText,
          inline: false
        });
      }

      // Ajouter les nouveaux ordres de vente
      if (newSellOrders.length > 0) {
        const sellOrdersText = newSellOrders
          .slice(0, 5) // Limiter à 5 ordres
          .map(order => {
            const price = (order.price / 10000).toLocaleString('fr-FR');
            return `**${order.username || 'Utilisateur supprimé'}**\n└ ${price}$ • ${order.shares} parts • #${order.orderId}`;
          })
          .join('\n\n');

        embed.addFields({
          name: `📉 Nouveaux Ordres de Vente (${newSellOrders.length})`,
          value: sellOrdersText,
          inline: false
        });
      }

      embed.setFooter({ 
        text: `Surveillé toutes les ${this.checkInterval / 60000} minutes • Soccerverse Bot v3.0` 
      });

      await channel.send({ embeds: [embed] });
      
      logger.info(`📊 Notification orderbook envoyée: Club ${clubId}, Canal ${channelId}, ${newBuyOrders.length} achats, ${newSellOrders.length} ventes`);
      
    } catch (error) {
      logger.error('Erreur envoi notification orderbook:', error);
    }
  }

  // Méthode unifiée et améliorée pour récupérer l'orderbook
// À remplacer dans BOTH orderbook.js ET OrderbookWatcher.js

async fetchClubOrderbook(clubId) {
  try {
    const axios = require('axios');
    
    // 1. ESSAYER D'ABORD L'API DIRECTE (sans proxy)
    try {
      console.log(`🌐 Tentative API directe pour club ${clubId}`);
      const response = await axios.get('https://orderbook.soccerverse.io/clubs', {
        timeout: 8000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SoccerverseBot/3.0',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      if (response.status === 200 && response.data && response.data.data && response.data.data[clubId]) {
        console.log(`✅ API directe réussie pour club ${clubId}`);
        return this.parseOrderbookData(response.data.data[clubId], clubId);
      }
    } catch (error) {
      console.log(`⚠️ API directe échouée: ${error.message}`);
    }
    
    // 2. FALLBACK: PROXIES CORS avec cache-busting
    const proxies = [
      'https://api.allorigins.win/raw?url=',
      'https://cors-anywhere.herokuapp.com/',
      'https://api.codetabs.com/v1/proxy?quest=',
      'https://thingproxy.freeboard.io/fetch/',
      'https://cors.bridged.cc/',
      'https://corsproxy.io/?'
    ];
    
    // Ajouter cache-busting timestamp
    const cacheBuster = Date.now();
    const targetUrl = `https://orderbook.soccerverse.io/clubs?t=${cacheBuster}`;
    
    for (let i = 0; i < proxies.length; i++) {
      const proxy = proxies[i];
      try {
        console.log(`🔄 Tentative proxy ${i + 1}/${proxies.length}: ${proxy.split('://')[1].split('/')[0]}`);
        
        const response = await axios.get(proxy + encodeURIComponent(targetUrl), {
          timeout: 12000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'SoccerverseBot/3.0',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        if (response.status !== 200) {
          console.log(`❌ Proxy ${i + 1} - HTTP ${response.status}`);
          continue;
        }
        
        let data;
        try {
          // Certains proxies retournent une string, d'autres un objet
          data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        } catch (parseError) {
          console.log(`❌ Proxy ${i + 1} - Parsing JSON failed`);
          continue;
        }
        
        if (data && data.data && data.data[clubId]) {
          console.log(`✅ Proxy ${i + 1} réussi pour club ${clubId}`);
          return this.parseOrderbookData(data.data[clubId], clubId);
        } else {
          console.log(`❌ Proxy ${i + 1} - Données club ${clubId} manquantes`);
        }
        
      } catch (error) {
        console.log(`❌ Proxy ${i + 1} - Erreur: ${error.message}`);
        continue;
      }
    }
    
    console.log(`❌ Tous les proxies ont échoué pour club ${clubId}`);
    throw new Error('Impossible de récupérer l\'orderbook via tous les proxies');
    
  } catch (error) {
    console.error(`💥 Erreur fetchClubOrderbook ${clubId}:`, error.message);
    throw new Error(`Impossible de récupérer l'orderbook: ${error.message}`);
  }
}

// Méthode helper pour parser les données (à ajouter aussi)
parseOrderbookData(orders, clubId) {
  if (!Array.isArray(orders)) {
    throw new Error(`Données orderbook invalides pour club ${clubId}`);
  }
  
  console.log(`📊 Parsing ${orders.length} ordres pour club ${clubId}`);
  
  // Séparer les ordres d'achat (0) et de vente (1)
  const buyOrders = orders
    .filter(order => order[2] === 0)
    .map(order => ({
      orderId: order[0],
      username: order[1] || 'Utilisateur supprimé',
      isAsk: order[2],
      price: order[3],
      shares: order[4]
    }));
  
  const sellOrders = orders
    .filter(order => order[2] === 1)
    .map(order => ({
      orderId: order[0],
      username: order[1] || 'Utilisateur supprimé',
      isAsk: order[2],
      price: order[3],
      shares: order[4]
    }));
  
  console.log(`✅ Club ${clubId}: ${buyOrders.length} achats, ${sellOrders.length} ventes`);
  
  return { buyOrders, sellOrders };
}
  }

  // Méthodes de gestion de la surveillance
  
  enableWatching(channelId, clubId, minPrice, maxPrice) {
    const settings = this.dataManager.getChannelSettings(channelId);
    const orderbookWatching = settings.orderbookWatching || {};
    
    orderbookWatching[clubId] = {
      minPrice: minPrice ? minPrice * 10000 : undefined,
      maxPrice: maxPrice ? maxPrice * 10000 : undefined,
      enabled: true,
      startedAt: Date.now()
    };
    
    this.dataManager.setChannelSettings(channelId, {
      orderbookWatching: orderbookWatching
    });
    
    // Réinitialiser le cache pour ce club
    this.lastSeenOrders.delete(clubId);
    
    logger.info(`🔍 Surveillance orderbook activée: Club ${clubId}, Canal ${channelId}`);
  }

  disableWatching(channelId, clubId) {
    const settings = this.dataManager.getChannelSettings(channelId);
    
    if (settings.orderbookWatching && settings.orderbookWatching[clubId]) {
      settings.orderbookWatching[clubId].enabled = false;
      
      this.dataManager.setChannelSettings(channelId, settings);
      
      logger.info(`🔍 Surveillance orderbook désactivée: Club ${clubId}, Canal ${channelId}`);
    }
  }

  getWatchingStatus(channelId, clubId) {
    const settings = this.dataManager.getChannelSettings(channelId);
    
    if (settings.orderbookWatching && settings.orderbookWatching[clubId]) {
      return settings.orderbookWatching[clubId];
    }
    
    return null;
  }
}

module.exports = OrderbookWatcher;
