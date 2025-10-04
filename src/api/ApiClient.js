const axios = require('axios');
const logger = require('../utils/logger');
const MappingManager = require('../utils/MappingManager');

class ApiClient {
  constructor() {
    this.baseUrl = 'https://services.soccerverse.com/api';
    this.rpcUrl = 'https://gsppub.soccerverse.io/';
    
    // Cache simple en mémoire
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    
    // Gestionnaire de mappings
    this.mappingManager = new MappingManager();
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

  // =================== REQUÊTES API ===================
  
  async makeRequest(endpoint, params = {}) {
    try {
      const cacheKey = this.getCacheKey(endpoint, params);
      const cached = this.getFromCache(cacheKey);
      
      if (cached) {
        logger.debug(`📦 Cache hit: ${endpoint}`);
        return cached;
      }
      
      logger.debug(`🌐 API call: ${endpoint}`, params);
      
      const response = await axios.get(`${this.baseUrl}${endpoint}`, {
        params,
        timeout: 10000,
        headers: {
          'User-Agent': 'SoccerverseBot/3.0'
        }
      });
      
      this.setCache(cacheKey, response.data);
      return response.data;
      
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

      const response = await axios.post(this.rpcUrl, payload, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SoccerverseBot/3.0'
        }
      });
      
      if (response.data && response.data.error) {
        logger.error(`❌ RPC Error: ${method}`, response.data.error);
        throw new Error(`RPC Error: ${response.data.error.message || 'Unknown error'}`);
      }
      
      const result = response.data?.result;
      this.setCache(cacheKey, result);
      return result;
      
    } catch (error) {
      logger.error(`❌ Erreur RPC ${method}:`, error.message);
      throw new Error(`Erreur RPC: ${error.message}`);
    }
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
    try {
      const currentSeason = await this.makeRpcRequest('get_current_season', {});
      if (currentSeason && currentSeason.season_id) {
        logger.debug(`✅ Saison courante trouvée: ${currentSeason.season_id}`);
        return currentSeason.season_id;
      }
    } catch (error) {
      logger.debug(`⚠️ get_current_season a échoué: ${error.message}`);
    }

    try {
      const seasonInfo = await this.makeRpcRequest('get_season_info', {});
      if (seasonInfo && seasonInfo.current_season) {
        logger.debug(`✅ Saison courante trouvée via season_info: ${seasonInfo.current_season}`);
        return seasonInfo.current_season;
      }
    } catch (error) {
      logger.debug(`⚠️ get_season_info a échoué: ${error.message}`);
    }

    try {
      const recentMatches = await this.makeRpcRequest('get_club_schedule', {
        club_id: 1013,
        season_id: 2
      });
      
      if (recentMatches && Array.isArray(recentMatches) && recentMatches.length > 0) {
        const now = Date.now() / 1000;
        const sixMonthsAgo = now - (6 * 30 * 24 * 60 * 60);
        const recentMatch = recentMatches.find(match => match.date > sixMonthsAgo);
        
        if (recentMatch) {
          logger.debug(`✅ Saison 2 confirmée via matchs récents`);
          return 2;
        }
      }
    } catch (error) {
      logger.debug(`⚠️ Analyse matchs saison 2 échouée: ${error.message}`);
    }

    try {
      const season1Matches = await this.makeRpcRequest('get_club_schedule', {
        club_id: 1013,
        season_id: 1
      });
      
      if (season1Matches && Array.isArray(season1Matches) && season1Matches.length > 0) {
        logger.debug(`✅ Fallback vers saison 1`);
        return 1;
      }
    } catch (error) {
      logger.debug(`⚠️ Fallback saison 1 échoué: ${error.message}`);
    }

    logger.warn('Impossible de déterminer la saison courante, utilisation de la saison 2');
    return 2;
  }

  async getClubLastMatch(clubId) {
    if (!clubId || isNaN(clubId)) {
      throw new Error('ID de club invalide');
    }
    
    // ✅ CORRECTION MAJEURE: Utiliser get_club_schedule au lieu de get_clubs_last_fixture
    // Raison: get_clubs_last_fixture NE RETOURNE PAS le flag "played"
    // Ce flag est ESSENTIEL pour détecter si un match est terminé
    try {
      for (const seasonId of [2, 1]) {
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
          
          logger.debug(`✅ Dernier match (S${seasonId}, played=${lastMatch.played}): ${enrichedMatch.home_club_name} ${lastMatch.home_goals}-${lastMatch.away_goals} ${enrichedMatch.away_club_name}`);
          
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

  async getClubSchedule(clubId, limit = 20) {
    if (!clubId || isNaN(clubId)) {
      throw new Error('ID de club invalide');
    }
    
    const currentSeason = await this.getCurrentSeason();
    
    const result = await this.makeRpcRequest('get_club_schedule', {
      club_id: parseInt(clubId),
      season_id: currentSeason
    });
    
    if (!result || !Array.isArray(result)) {
      throw new Error(`Aucun match trouvé pour le club ${clubId} en saison ${currentSeason}`);
    }
    
    const matches = result.sort((a, b) => b.date - a.date);
    
    const enrichedMatches = matches.map(match => ({
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

  // =================== MÉTHODES CLASSEMENTS ===================
  
  async getLeagueTable(leagueId) {
    if (!leagueId || isNaN(leagueId)) {
      throw new Error('ID de ligue invalide');
    }

    let data;
    try {
      data = await this.makeRequest('/league_tables', {
        league_id: parseInt(leagueId),
        limit: 100,
        all: true
      });
    } catch (error) {
      data = await this.makeRequest('/league_tables', { league_id: parseInt(leagueId) });
    }
    
    if (!data || !Array.isArray(data)) {
      throw new Error(`Classement introuvable pour la ligue ${leagueId}`);
    }

    logger.debug(`📊 Classement ligue ${leagueId}: ${data.length} équipes`);

    const sortedTable = data.sort((a, b) => a.new_position - b.new_position);
    
    const enrichedTable = sortedTable.map(team => ({
      ...team,
      club_name: this.getClubName(team.club_id)
    }));
    
    return enrichedTable;
  }

  // =================== UTILITAIRES FORMAT ===================
  
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
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffHours < 1) {
      return 'Il y a moins d\'1h';
    } else if (diffHours < 24) {
      return `Il y a ${diffHours}h`;
    } else if (diffDays < 7) {
      return `Il y a ${diffDays}j`;
    } else {
      return date.toLocaleDateString('fr-FR');
    }
  }
  
  formatForm(form) {
    if (!form) return 'Aucune';
    
    return form.split('').map(char => {
      switch (char) {
        case 'W': return '🟢';
        case 'D': return '🟡';
        case 'L': return '🔴';
        default: return '⚪';
      }
    }).join('');
  }

  getCompetitionType(compType) {
    switch(compType) {
      case 0: return '🏆 Championnat';
      case 1: return '🏅 Coupe';
      default: return '⚽ Match';
    }
  }

  formatMatchDate(unixTimestamp) {
    const date = new Date(unixTimestamp * 1000);
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMs < 0) {
      const futureDiffMs = Math.abs(diffMs);
      const futureDiffHours = Math.floor(futureDiffMs / (1000 * 60 * 60));
      const futureDiffDays = Math.floor(futureDiffHours / 24);
      
      if (futureDiffHours < 24) {
        return `Dans ${futureDiffHours}h`;
      } else if (futureDiffDays < 7) {
        return `Dans ${futureDiffDays}j`;
      } else {
        return date.toLocaleDateString('fr-FR');
      }
    }
    
    if (diffHours < 1) {
      return 'Il y a moins d\'1h';
    } else if (diffHours < 24) {
      return `Il y a ${diffHours}h`;
    } else if (diffDays < 7) {
      return `Il y a ${diffDays}j`;
    } else {
      return date.toLocaleDateString('fr-FR');
    }
  }

  formatMatchResult(match, clubId) {
    const isHome = match.home_club === parseInt(clubId);
    const clubGoals = isHome ? match.home_goals : match.away_goals;
    const opponentGoals = isHome ? match.away_goals : match.home_goals;
    
    let result = '';
    if (match.played === 1) {
      if (clubGoals > opponentGoals) {
        result = '🟢 V';
      } else if (clubGoals < opponentGoals) {
        result = '🔴 D';
      } else {
        result = '🟡 N';
      }
    } else {
      result = '⏳ À venir';
    }
    
    return result;
  }
}

module.exports = ApiClient;
