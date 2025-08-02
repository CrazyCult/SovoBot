const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const logger = require('./logger');

class MappingManager {
  constructor() {
    this.mappingDir = path.join(__dirname, '..', '..', 'mappings');
    this.dataPackUrl = 'https://elrincondeldt.com/sv/rincon_v1.json';
    this.mappingFile = path.join(this.mappingDir, 'soccerverse_data.json');
    
    // Maps en mémoire pour accès rapide
    this.clubNames = new Map();
    this.playerNames = new Map();
    this.leagueNames = new Map();
    this.stadiumNames = new Map();
    this.cupNames = new Map();
    
    // Timestamp de dernière mise à jour
    this.lastUpdate = null;
    
    // Initialiser
    this.initialize();
  }

  async initialize() {
    try {
      // Créer le dossier mappings s'il n'existe pas
      await fs.mkdir(this.mappingDir, { recursive: true });
      
      // Charger les données existantes
      await this.loadMappings();
      
      // Vérifier si une mise à jour est nécessaire
      await this.checkForUpdates();
      
      // Programmer la mise à jour hebdomadaire (dimanche à 3h du matin)
      this.scheduleWeeklyUpdate();
      
    } catch (error) {
      logger.error('Erreur initialisation MappingManager:', error);
    }
  }

  // =================== CHARGEMENT DES MAPPINGS ===================
  
  async loadMappings() {
    try {
      const data = await fs.readFile(this.mappingFile, 'utf8');
      const jsonData = JSON.parse(data);
      
      // Vérifier la structure du fichier
      if (!jsonData.PackData) {
        logger.warn('Structure de données invalide dans le fichier mapping');
        return;
      }
      
      const packData = jsonData.PackData;
      
      // Charger les clubs
      this.loadClubs(packData.ClubData);
      
      // Charger les joueurs
      this.loadPlayers(packData.PlayerData);
      
      // Charger les ligues
      this.loadLeagues(packData.LeagueData);
      
      // Charger les stades
      this.loadStadiums(packData.StadiumData);
      
      // Charger les coupes
      this.loadCups(packData.CupData);
      
      // Mettre à jour le timestamp
      if (jsonData.meta && jsonData.meta.lastUpdate) {
        this.lastUpdate = new Date(jsonData.meta.lastUpdate);
      }
      
      logger.info(`✅ Mappings chargés: ${this.clubNames.size} clubs, ${this.playerNames.size} joueurs, ${this.leagueNames.size} ligues, ${this.stadiumNames.size} stades, ${this.cupNames.size} coupes`);
      
    } catch (error) {
      logger.warn('⚠️ Aucun fichier mapping existant, téléchargement initial...');
      await this.updateMappings();
    }
  }

  loadClubs(clubData) {
    this.clubNames.clear();
    
    if (clubData && clubData.C && Array.isArray(clubData.C)) {
      for (const club of clubData.C) {
        if (club.id && club.n) {
          // Les IDs de clubs sont aussi des strings
          const clubId = parseInt(club.id);
          this.clubNames.set(clubId, club.n);
        }
      }
    }
  }

  loadPlayers(playerData) {
    this.playerNames.clear();
    
    if (playerData && playerData.P && Array.isArray(playerData.P)) {
      for (const player of playerData.P) {
        if (player.id && (player.f || player.s)) {
          // Les IDs de joueurs sont aussi des strings
          const playerId = parseInt(player.id);
          const fullName = `${player.f || ''} ${player.s || ''}`.trim();
          if (fullName) {
            this.playerNames.set(playerId, fullName);
          }
        }
      }
    }
  }

  loadLeagues(leagueData) {
    this.leagueNames.clear();
    
    if (leagueData && leagueData.L && Array.isArray(leagueData.L)) {
      for (const league of leagueData.L) {
        if (league.c && league.d && league.n) {
          // Créer une clé unique basée sur pays + division
          // Exemple: CHE_1 pour Suisse Division 1
          const leagueKey = `${league.c}_${league.d}`;
          this.leagueNames.set(leagueKey, league.n);
          
          // Debug pour voir les mappings créés
          logger.debug(`🏆 Ligue mappée: ${leagueKey} -> ${league.n}`);
        }
      }
    }
  }

  loadStadiums(stadiumData) {
    this.stadiumNames.clear();
    
    if (stadiumData && stadiumData.S && Array.isArray(stadiumData.S)) {
      for (const stadium of stadiumData.S) {
        if (stadium.id && stadium.n) {
          // Les IDs de stades sont aussi des strings
          const stadiumId = parseInt(stadium.id);
          this.stadiumNames.set(stadiumId, stadium.n);
        }
      }
    }
  }

  loadCups(cupData) {
    this.cupNames.clear();
    
    if (cupData && cupData.C && Array.isArray(cupData.C)) {
      for (const cup of cupData.C) {
        if (cup.id && cup.n) {
          this.cupNames.set(cup.id, cup.n); // Les IDs de coupes peuvent être des strings
        }
      }
    }
  }

  // =================== MISE À JOUR DES MAPPINGS ===================
  
  async checkForUpdates() {
    try {
      const now = new Date();
      
      // Si pas de dernière mise à jour, ou si plus de 7 jours
      if (!this.lastUpdate || (now - this.lastUpdate) > (7 * 24 * 60 * 60 * 1000)) {
        logger.info('🔄 Mise à jour des mappings nécessaire');
        await this.updateMappings();
      } else {
        const nextUpdate = new Date(this.lastUpdate.getTime() + (7 * 24 * 60 * 60 * 1000));
        logger.info(`ℹ️ Prochaine mise à jour des mappings: ${nextUpdate.toLocaleDateString('fr-FR')}`);
      }
      
    } catch (error) {
      logger.error('Erreur vérification mises à jour:', error);
    }
  }

  async updateMappings() {
    try {
      logger.info('🌐 Téléchargement du data pack Soccerverse...');
      
      const response = await axios.get(this.dataPackUrl, {
        timeout: 30000,
        headers: {
          'User-Agent': 'SoccerverseBot/3.0'
        }
      });
      
      // Ajouter des métadonnées
      const dataWithMeta = {
        ...response.data,
        meta: {
          lastUpdate: new Date().toISOString(),
          source: this.dataPackUrl,
          version: '3.0'
        }
      };
      
      // Sauvegarder le fichier
      await fs.writeFile(this.mappingFile, JSON.stringify(dataWithMeta, null, 2));
      
      // Recharger en mémoire
      await this.loadMappings();
      
      logger.info('✅ Mappings mis à jour avec succès');
      
    } catch (error) {
      logger.error('❌ Erreur mise à jour mappings:', error);
      throw error;
    }
  }

  // =================== PROGRAMMATION AUTOMATIQUE ===================
  
  scheduleWeeklyUpdate() {
    // Programmer pour dimanche à 3h du matin (0 3 * * 0)
    cron.schedule('0 3 * * 0', async () => {
      try {
        logger.info('🕒 Mise à jour automatique hebdomadaire des mappings...');
        await this.updateMappings();
      } catch (error) {
        logger.error('Erreur mise à jour automatique:', error);
      }
    }, {
      scheduled: true,
      timezone: "Europe/Paris"
    });
    
    logger.info('⏰ Mise à jour automatique programmée: dimanche 3h00');
  }

  // =================== MÉTHODES PUBLIQUES ===================
  
  getClubName(clubId) {
    return this.clubNames.get(parseInt(clubId)) || `Club #${clubId}`;
  }
  
  getPlayerName(playerId) {
    return this.playerNames.get(parseInt(playerId)) || `Joueur #${playerId}`;
  }
  
  getLeagueName(leagueId) {
    // Cette méthode ne peut plus fonctionner avec juste l'ID
    // Il faut maintenant utiliser getLeagueNameByCountryDivision
    return `Ligue #${leagueId}`;
  }
  
  getLeagueNameByCountryDivision(countryCode, division) {
    const leagueKey = `${countryCode}_${division + 1}`; // +1 car division API commence à 0
    return this.leagueNames.get(leagueKey) || `Ligue ${countryCode} D${division + 1}`;
  }
  
  getStadiumName(stadiumId) {
    return this.stadiumNames.get(parseInt(stadiumId)) || `Stade #${stadiumId}`;
  }
  
  getCupName(cupId) {
    return this.cupNames.get(cupId) || `Coupe #${cupId}`;
  }

  // Obtenir les infos détaillées d'un club
  getClubDetails(clubId) {
    const clubData = this.getClubData(parseInt(clubId));
    if (clubData) {
      return {
        id: clubData.id,
        name: clubData.n,
        color: clubData.rgb
      };
    }
    return null;
  }

  getClubData(clubId) {
    // Pour obtenir les données complètes, il faudrait garder les données originales
    // Pour l'instant, on retourne juste le nom
    const name = this.getClubName(clubId);
    if (name !== `Club #${clubId}`) {
      return { id: clubId, n: name };
    }
    return null;
  }

  // Forcer la mise à jour manuelle
  async forceUpdate() {
    logger.info('🔄 Mise à jour forcée des mappings...');
    await this.updateMappings();
  }

  // Statistiques
  getStats() {
    return {
      clubs: this.clubNames.size,
      players: this.playerNames.size,
      leagues: this.leagueNames.size,
      stadiums: this.stadiumNames.size,
      cups: this.cupNames.size,
      lastUpdate: this.lastUpdate,
      nextUpdate: this.lastUpdate ? new Date(this.lastUpdate.getTime() + (7 * 24 * 60 * 60 * 1000)) : null
    };
  }

  // Recherche de clubs par nom
  searchClubs(searchTerm, limit = 10) {
    const results = [];
    const searchLower = searchTerm.toLowerCase();
    
    for (const [clubId, clubName] of this.clubNames.entries()) {
      if (clubName.toLowerCase().includes(searchLower)) {
        results.push({
          id: clubId,
          name: clubName
        });
        
        if (results.length >= limit) break;
      }
    }
    
    return results;
  }
}

module.exports = MappingManager;