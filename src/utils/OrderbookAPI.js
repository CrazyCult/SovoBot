const axios = require('axios');
const logger = require('./logger');

class OrderbookAPI {
  constructor() {
    this.proxies = [
      'https://api.allorigins.win/raw?url=',
      'https://cors-anywhere.herokuapp.com/',
      'https://api.codetabs.com/v1/proxy?quest=',
      'https://thingproxy.freeboard.io/fetch/',
      'https://cors.bridged.cc/',
      'https://corsproxy.io/?'
    ];
  }

  async fetchClubOrderbook(clubId) {
    try {
      // 1. ESSAYER D'ABORD L'API DIRECTE (sans proxy)
      try {
        logger.debug(`🌐 Tentative API directe pour club ${clubId}`);
        const response = await axios.get('https://orderbook.soccerverse.io/clubs', {
          timeout: 8000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Referer': 'https://soccerverse.io'
          }
        });
        
        if (response.status === 200 && response.data && response.data.data && response.data.data[clubId]) {
          logger.debug(`✅ API directe réussie pour club ${clubId}`);
          return this.parseOrderbookData(response.data.data[clubId], clubId);
        } else if (response.status === 200 && response.data && response.data.data) {
          // API fonctionne mais pas d'ordres pour ce club
          logger.debug(`✅ API directe réussie pour club ${clubId} - aucun ordre`);
          return { buyOrders: [], sellOrders: [] };
        }
      } catch (error) {
        logger.debug(`⚠️ API directe échouée: ${error.message}`);
      }
      
      // 2. FALLBACK: PROXIES CORS avec cache-busting
      const cacheBuster = Date.now();
      const targetUrl = `https://orderbook.soccerverse.io/clubs?t=${cacheBuster}`;
      
      for (let i = 0; i < this.proxies.length; i++) {
        const proxy = this.proxies[i];
        try {
          logger.debug(`🔄 Tentative proxy ${i + 1}/${this.proxies.length}: ${proxy.split('://')[1].split('/')[0]}`);
          
          const response = await axios.get(proxy + encodeURIComponent(targetUrl), {
            timeout: 15000,
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
              'Referer': 'https://soccerverse.io'
            }
          });
          
          if (response.status !== 200) {
            logger.debug(`❌ Proxy ${i + 1} - HTTP ${response.status}`);
            continue;
          }
          
          let data;
          try {
            // Certains proxies retournent une string, d'autres un objet
            data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
          } catch (parseError) {
            logger.debug(`❌ Proxy ${i + 1} - Parsing JSON failed`);
            continue;
          }
          
          if (data && data.data && data.data[clubId]) {
            logger.debug(`✅ Proxy ${i + 1} réussi pour club ${clubId}`);
            return this.parseOrderbookData(data.data[clubId], clubId);
          } else if (data && data.data) {
            // API fonctionne mais pas d'ordres pour ce club
            logger.debug(`✅ Proxy ${i + 1} réussi pour club ${clubId} - aucun ordre`);
            return { buyOrders: [], sellOrders: [] };
          } else {
            logger.debug(`❌ Proxy ${i + 1} - Données club ${clubId} manquantes`);
          }
          
        } catch (error) {
          logger.debug(`❌ Proxy ${i + 1} - Erreur: ${error.message}`);
          // Attendre un peu avant le prochain proxy pour éviter le rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
      }
      
      logger.warn(`❌ Tous les proxies ont échoué pour club ${clubId}`);
      throw new Error('Impossible de récupérer l\'orderbook via tous les proxies');
      
    } catch (error) {
      logger.error(`💥 Erreur fetchClubOrderbook ${clubId}:`, error.message);
      throw new Error(`Impossible de récupérer l'orderbook: ${error.message}`);
    }
  }

  parseOrderbookData(orders, clubId) {
    if (!Array.isArray(orders)) {
      throw new Error(`Données orderbook invalides pour club ${clubId}`);
    }
    
    logger.debug(`📊 Parsing ${orders.length} ordres pour club ${clubId}`);
    
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
    
    return { buyOrders, sellOrders };
  }
}

module.exports = OrderbookAPI;
