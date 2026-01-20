const axios = require('axios');
const logger = require('../utils/logger');
const MappingManager = require('../utils/MappingManager');
const RateLimiter = require('../utils/RateLimiter');

class ApiClient {
  constructor() {
    this.baseUrl = 'https://services.soccerverse.com/api';
    this.rpcUrl = 'https://services.soccerverse.com/gsp/';
    
    // ✅ RATE LIMITER GLOBAL (3 requêtes/seconde)
    this.rateLimiter = new RateLimiter(3);
    
    // ✅ IDENTIFICATION DU BOT
    this.botIdentity = {
      name: 'SoccerverseBot',
      version: '3.0',
      author: 'CrazyCult',
      discord_id: '219439055107129354',
      contact: 'discord:219439055107129354',
      purpose: 'Discord notification bot for Soccerverse clubs'
    };
    
    // Cache simple en mémoire
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    
    // ✅ Cache spécifique pour la saison courante (24h)
    this.currentSeasonCache = null;
    this.currentSeasonCacheTime = null;
    this.seasonCacheTimeout = 24 * 60 * 60 * 1000; // 24 heures
    
    // Gestionnaire de mappings
    this.mappingManager = new MappingManager();
    
    logger.info(`🤖 Bot initialisé: ${this.getBotSignature()}`);
  }

  // =================== IDENTIFICATION ===================
  
  getBotSignature() {
    return `${this.botIdentity.name}/${this.botIdentity.version} (${this.botIdentity.author})`;
  }
  
  getBotHeaders() {
    return {
      'User-Agent': this.getBotSignature(),
      'X-Bot-Name': this.botIdentity.name,
      'X-Bot-Version': this.botIdentity.version,
      'X-Bot-Author': this.botIdentity.author,
      'X-Bot-Contact': this.botIdentity.contact,
      'X-Bot-Purpose': this.botIdentity.purpose
    };
  }

  // =================== CACHE ===================
  
  getCacheKey(endpoint, params = {}) {
    return `${endpoint}_${JSON.stringify(params)}`;
  }
  
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > this.cacheTimeout) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data;
  }
  
  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  // =================== UTILITAIRES NOMS ===================
  
  getClubName(clubId) {
    return this.mappingManager.getClubName(clubId);
  }
  
  getPlayerName(playerId) {
    return this.mappingManager.getPlayerName(playerId);
  }
  
  getLeagueName(leagueId) {
    const name = this.mappingManager.getLeagueName(leagueId);
    if (name === `Ligue #${leagueId}`) {
      logger.debug(`🔍 Ligue ${leagueId} introuvable. Mappings disponibles: ${this.mappingManager.leagueNames.size}`);
    }
    return name;
  }
  
  getLeagueNameByCountryDivision(countryCode, division) {
    return this.mappingManager.getLeagueNameByCountryDivision(countryCode, division);
  }
  
  getStadiumName(stadiumId) {
    return this.mappingManager.getStadiumName(stadiumId);
  }
  
  getCupName(cupId) {
    return this.mappingManager.getCupName(cupId);
  }

  // =================== UTILITAIRES LIENS ===================
  
  getSoccerverseClubLink(clubId) {
    return `https://play.soccerverse.com/club/${clubId}`;
  }
  
  formatClubLink(clubId, clubName) {
    return `[${clubName}](https://play.soccerverse.com/club/${clubId})`;
  }

  formatClubLinkMarkdown(clubId, clubName = null) {
    const name = clubName || this.getClubName(clubId);
    return `[${name}](https://play.soccerverse.com/club/${clubId})`;
  }

  // =================== REQUÊTES API AVEC RATE LIMITING + CLOUDFLARE BYPASS ===================
  
  async makeRequest(endpoint, params = {}) {
    try {
      const cacheKey = this.getCacheKey(endpoint, params);
      const cached = this.getFromCache(cacheKey);
      
      if (cached) {
        logger.debug(`📦 Cache hit: ${endpoint}`);
        return cached;
      }
      
      logger.debug(`🌐 API call: ${endpoint}`, params);
      
      // ✅ UTILISER LE RATE LIMITER + CLOUDFLARE HEADERS
      const data = await this.rateLimiter.execute(async () => {
        const response = await axios.get(`${this.baseUrl}${endpoint}`, {
          params,
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://play.soccerverse.com',           // ✅ CLOUDFLARE BYPASS
            'Referer': 'https://play.soccerverse.com/',         // ✅ CLOUDFLARE BYPASS
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ...this.getBotHeaders()
          }
        });
        return response.data;
      }, `GET ${endpoint}`);
      
      this.setCache(cacheKey, data);
      return data;
      
    } catch (error) {
      logger.error(`❌ Erreur API ${endpoint}:`, error.message);
      throw new Error(`Erreur API: ${error.message}`);
    }
  }

  async makeRpcRequest(method, params = {}) {
    try {
      const cacheKey = this.getCacheKey(method, params);
      const cached = this.getFromCache(cacheKey);
      
      if (cached) {
        logger.debug(`📦 Cache hit RPC: ${method}`);
        return cached;
      }
      
      logger.debug(`🌐 RPC call: ${method}`, params);
      
      const payload = {
        jsonrpc: "2.0",
        method: method,
        params: params,
        id: Date.now()
      };

      // ✅ UTILISER LE RATE LIMITER + CLOUDFLARE HEADERS
      const data = await this.rateLimiter.execute(async () => {
        const response = await axios.post(this.rpcUrl, payload, {
          timeout: 15000,
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://play.soccerverse.com',           // ✅ CLOUDFLARE BYPASS
            'Referer': 'https://play.soccerverse.com/',         // ✅ CLOUDFLARE BYPASS
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ...this.getBotHeaders()
          }
        });
            
      if (response.data && response.data.error) {
        logger.error(`❌ RPC Error: ${method}`, response.data.error);
        throw new Error(`RPC Error: ${response.data.error.message || 'Unknown error'}`);
      }
      
      // ✅ Gérer les deux formats : .result OU .data
      if (response.data?.result !== undefined && response.data?.result !== null) {
        return response.data.result;
      } else if (response.data?.data !== undefined) {
        return response.data.data;
      } else {
        return response.data;
      } 
        
      }, `RPC ${method}`);
      
      this.setCache(cacheKey, data);
      return data;
      
    } catch (error) {
      logger.error(`❌ Erreur RPC ${method}:`, error.message);
      throw new Error(`Erreur RPC: ${error.message}`);
    }
  }

  // =================== STATISTIQUES RATE LIMITER ===================
  
  getRateLimiterStats() {
    return this.rateLimiter.getStats();
  }
  
  resetRateLimiterStats() {
    this.rateLimiter.resetStats();
  }
  
  clearRateLimiterQueue() {
    return this.rateLimiter.clearQueue();
  }

  // =================== MÉTHODES CLUBS ===================
  
  async getClubDetails(clubId) {
    if (!clubId || isNaN(clubId)) {
      throw new Error('ID de club invalide');
    }
    
    const data = await this.makeRequest('/clubs/detailed', { club_id: parseInt(clubId) });
    
    if (!data.items || data.items.length === 0) {
      throw new Error(`Club ${clubId} introuvable`);
    }
    
    const club = data.items[0];
    club.display_name = this.getClubName(club.club_id);
    
    return club;
  }

  async getCurrentSeason() {
    if (this.currentSeasonCache && this.currentSeasonCacheTime) {
      const age = Date.now() - this.currentSeasonCacheTime;
      if (age < this.seasonCacheTimeout) {
        logger.debug(`✅ Saison courante (cache): ${this.currentSeasonCache}`);
        return this.currentSeasonCache;
      }
    }

    try {
      const result = await this.makeRpcRequest('get_seasons', {});
      
      let seasons = [];
      if (Array.isArray(result)) {
        seasons = result;
      } else if (result && Array.isArray(result.data)) {
        seasons = result.data;
      }
      
      if (seasons.length === 0) {
        logger.warn('⚠️ Aucune saison retournée par get_seasons, fallback sur 3');
        this.currentSeasonCache = 3;
        this.currentSeasonCacheTime = Date.now();
        return 3;
      }
      
      const currentSeason = seasons.find(s => s.is_current === 1 || s.is_current === true);
      
      if (currentSeason) {
        this.currentSeasonCache = currentSeason.season_id;
        this.currentSeasonCacheTime = Date.now();
        logger.info(`✅ Saison courante détectée: ${this.currentSeasonCache}`);
        return this.currentSeasonCache;
      }
      
      const latestSeason = Math.max(...seasons.map(s => s.season_id));
      this.currentSeasonCache = latestSeason;
      this.currentSeasonCacheTime = Date.now();
      logger.info(`✅ Saison courante (dernière): ${this.currentSeasonCache}`);
      return this.currentSeasonCache;
      
    } catch (error) {
      logger.warn(`⚠️ get_seasons non disponible: ${error.message}`);
      logger.warn('⚠️ Impossible de déterminer la saison dynamiquement, utilisation de la saison 3 par défaut');
      
      this.currentSeasonCache = 3;
      this.currentSeasonCacheTime = Date.now();
      return 3;
    }
  }

  getCurrentSeasonCached() {
    if (this.currentSeasonCache) {
      return this.currentSeasonCache;
    }
    return 3;
  }

  async getClubSchedule(clubId, limit = 20) {
    if (!clubId || isNaN(clubId)) {
      throw new Error('ID de club invalide');
    }
    
    const currentSeason = await this.getCurrentSeason();
    
    const result = await this.makeRpcRequest('get_club_schedule', {
      club_id: parseInt(clubId),
      season_id: currentSeason
    });
    
    let matches = [];
    if (result && Array.isArray(result)) {
      matches = result;
    } else if (result && result.data && Array.isArray(result.data)) {
      matches = result.data;
    }
    
    if (matches.length === 0) {
      throw new Error(`Aucun match trouvé pour le club ${clubId} en saison ${currentSeason}`);
    }
    
    const sortedMatches = matches.sort((a, b) => b.date - a.date);
    
    const enrichedMatches = sortedMatches.map(match => ({
      ...match,
      home_club_name: this.getClubName(match.home_club),
      away_club_name: this.getClubName(match.away_club),
      stadium_name: this.getStadiumName(match.stadium_id),
      country_name: this.formatCountryName(match.country_id),
      competition_type: this.getCompetitionType(match.comp_type),
      season_id: currentSeason
    }));
    
    return enrichedMatches.slice(0, limit);
  }

  async getClubMatches(clubId, limit = 20) {
    return await this.getClubSchedule(clubId, limit);
  }

  async getClubLastMatch(clubId) {
    if (!clubId || isNaN(clubId)) {
      throw new Error('ID de club invalide');
    }
    
    try {
      for (const seasonId of [3, 2]) {
        const result = await this.makeRpcRequest('get_club_schedule', {
          club_id: parseInt(clubId),
          season_id: seasonId
        });
        
        let matches = [];
        if (result && result.data && Array.isArray(result.data)) {
          matches = result.data;
        } else if (result && Array.isArray(result)) {
          matches = result;
        }
        
        if (matches.length === 0) continue;
        
        const now = Math.floor(Date.now() / 1000);
        const playedMatches = matches
          .filter(match => match.played === 1 && match.date < now)
          .sort((a, b) => b.date - a.date);
        
        if (playedMatches.length > 0) {
          const lastMatch = playedMatches[0];
          
          const enrichedMatch = {
            ...lastMatch,
            home_club_name: this.getClubName(lastMatch.home_club),
            away_club_name: this.getClubName(lastMatch.away_club),
            stadium_name: this.getStadiumName(lastMatch.stadium_id),
            country_name: this.formatCountryName(lastMatch.country_id),
            competition_type: this.getCompetitionType(lastMatch.comp_type)
          };
          
          logger.debug(`✅ Dernier match (S${seasonId}): ${enrichedMatch.home_club_name} ${lastMatch.home_goals}-${lastMatch.away_goals} ${enrichedMatch.away_club_name}`);
          
          return enrichedMatch;
        }
      }
      
      throw new Error(`Aucun match joué trouvé pour le club ${clubId}`);
      
    } catch (error) {
      logger.error(`❌ Erreur getClubLastMatch ${clubId}:`, error);
      throw error;
    }
  }

  async getClubNextMatch(clubId) {
    if (!clubId || isNaN(clubId)) {
      throw new Error('ID de club invalide');
    }
    
    const result = await this.makeRpcRequest('get_clubs_next_fixture', {
      club_id: parseInt(clubId)
    });
    
    if (!result || !result.data) {
      throw new Error(`Aucun prochain match trouvé pour le club ${clubId}`);
    }
    
    const matchData = result.data;
    
    const enrichedMatch = {
      ...matchData,
      home_club_name: this.getClubName(matchData.home_club),
      away_club_name: this.getClubName(matchData.away_club),
      stadium_name: this.getStadiumName(matchData.stadium_id),
      country_name: this.formatCountryName(matchData.country_id),
      competition_type: this.getCompetitionType(matchData.comp_type)
    };
    
    return enrichedMatch;
  }

  async searchClubs(searchTerm, limit = 10) {
    const searchResults = this.mappingManager.searchClubs(searchTerm, limit);
    const results = [];
    
    for (const clubInfo of searchResults) {
      try {
        const clubData = await this.getClubDetails(clubInfo.id);
        results.push(clubData);
      } catch (error) {
        continue;
      }
    }
    
    return results;
  }

  async getLeagueTable(leagueId) {
  if (!leagueId || isNaN(leagueId)) {
    throw new Error('ID de ligue invalide');
  }
  
  const result = await this.makeRpcRequest('get_league_table', {
    league_id: parseInt(leagueId)
  });
  
  // ✅ AJOUT TEMPORAIRE
  logger.debug(`📊 get_league_table raw result:`, JSON.stringify(result, null, 2));
  
  if (!result || !Array.isArray(result)) {
    throw new Error(`Classement introuvable pour la ligue ${leagueId}`);
  }
  
  return result.map(entry => ({
    ...entry,
    club_name: this.getClubName(entry.club_id)
  }));
  }

  // =================== MÉTHODES UTILITAIRES ===================
  
  getCompetitionType(compType) {
    const types = {
      0: 'Match de championnat',
      1: 'Match de coupe nationale',
      2: 'Match amical',
      3: 'Match de barrage',
      4: 'Match de coupe continentale',
      5: 'Match de coupe mondiale'
    };
    
    return types[compType] || `Match (type ${compType})`;
  }

  formatMoney(amount) {
    if (!amount || amount === 0) return '0$';
    
    const dollars = Math.ceil(amount / 10000);
    
    if (dollars >= 1000000000) {
      return `${(dollars / 1000000000).toFixed(1)}B$`;
    } else if (dollars >= 1000000) {
      return `${(dollars / 1000000).toFixed(1)}M$`;
    } else if (dollars >= 1000) {
      return `${(dollars / 1000).toFixed(1)}K$`;
    } else {
      return `${dollars.toLocaleString()}$`;
    }
  }

  formatPercentageChange(current, start) {
    if (!start || start === 0) return 'N/A';
    
    const change = ((current - start) / start) * 100;
    
    if (change > 0) {
      return `+${change.toFixed(1)}%`;
    } else if (change < 0) {
      return `${change.toFixed(1)}%`;
    } else {
      return '0%';
    }
  }

  formatFansChange(current, start) {
    if (!start) return '';
    
    const diff = current - start;
    
    if (diff > 0) {
      return `(+${diff.toLocaleString()})`;
    } else if (diff < 0) {
      return `(${diff.toLocaleString()})`;
    } else {
      return '(=)';
    }
  }

  formatCapacityChange(current, start) {
    if (!start) return '';
    
    const diff = current - start;
    
    if (diff > 0) {
      return `(+${diff.toLocaleString()})`;
    } else if (diff < 0) {
      return `(${diff.toLocaleString()})`;
    } else {
      return '(=)';
    }
  }

  formatCountryName(countryCode) {
    const countries = {
      'CHE': '🇨🇭 Suisse',
      'FRA': '🇫🇷 France', 
      'ENG': '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Angleterre',
      'ESP': '🇪🇸 Espagne',
      'ITA': '🇮🇹 Italie',
      'GER': '🇩🇪 Allemagne',
      'BRA': '🇧🇷 Brésil',
      'ARG': '🇦🇷 Argentine',
      'USA': '🇺🇸 États-Unis',
      'CAN': '🇨🇦 Canada',
      'MEX': '🇲🇽 Mexique',
      'NED': '🇳🇱 Pays-Bas',
      'BEL': '🇧🇪 Belgique',
      'POR': '🇵🇹 Portugal',
      'ALB': '🇦🇱 Albanie',
      'AFR': '🌍 Afrique'
    };
    
    return countries[countryCode] || `🌍 ${countryCode}`;
  }
  
  formatTimestamp(unix) {
    if (!unix) return 'Jamais';
    
    const date = new Date(unix * 1000);
    return date.toLocaleString('fr-FR');
  }

  formatForm(form) {
    if (!form || form.length === 0) return 'Aucun match récent';
    
    const formArray = form.split('');
    return formArray.map(result => {
      if (result === 'W') return '🟢';
      if (result === 'D') return '🟡';
      if (result === 'L') return '🔴';
      return '⚪';
    }).join(' ');
  }
}

module.exports = ApiClient;
