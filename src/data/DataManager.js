const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class DataManager {
  constructor() {
    this.dataFile = path.join(__dirname, '..', '..', 'data', 'bot_data.json');
    this.data = {
      registrations: new Map(), // channelId -> Map(clubId -> {clubId, registeredBy, registeredAt})
      channelSettings: new Map(), // channelId -> settings object (RENOMMÉ pour cohérence)
      completedCompositions: new Map() // `${clubId}_${matchDate}` -> {clubId, matchDate, completedAt, completedBy}
    };
  }

  // =================== CHARGEMENT/SAUVEGARDE ===================
  
  async load() {
    try {
      const dataDir = path.dirname(this.dataFile);
      await fs.mkdir(dataDir, { recursive: true });
      
      try {
        await fs.access(this.dataFile);
      } catch (error) {
        logger.info('📄 Création du fichier de données');
        await this.save();
        return;
      }
      
      const fileContent = await fs.readFile(this.dataFile, 'utf8');
      const jsonData = JSON.parse(fileContent);
      
      // Convertir les objets en Maps
      if (jsonData.registrations) {
        for (const [channelId, clubs] of Object.entries(jsonData.registrations)) {
          const clubMap = new Map();
          
          // Support ancien format (array) et nouveau format (object)
          if (Array.isArray(clubs)) {
            // Ancien format: convertir en nouveau format
            for (const clubId of clubs) {
              clubMap.set(clubId.toString(), {
                clubId: clubId.toString(),
                registeredBy: null,
                registeredAt: Date.now()
              });
            }
          } else {
            // Nouveau format
            for (const [clubId, info] of Object.entries(clubs)) {
              clubMap.set(clubId, info);
            }
          }
          
          this.data.registrations.set(channelId, clubMap);
        }
      }
      
      // Support ancien nom "settings" et nouveau nom "channelSettings"
      const settingsData = jsonData.channelSettings || jsonData.settings;
      if (settingsData) {
        for (const [channelId, settings] of Object.entries(settingsData)) {
          this.data.channelSettings.set(channelId, settings);
        }
      }

      if (jsonData.completedCompositions) {
        for (const [key, data] of Object.entries(jsonData.completedCompositions)) {
          this.data.completedCompositions.set(key, data);
        }
      }

      const totalChannels = this.data.registrations.size;
      const totalClubs = this.getAllRegisteredClubs().length;

      logger.info(`✅ Données chargées: ${totalChannels} canaux, ${totalClubs} clubs`);
      
    } catch (error) {
      logger.error('❌ Erreur chargement données:', error);
    }
  }
  
  async save() {
    try {
      const jsonData = {
        registrations: {},
        channelSettings: {}, // RENOMMÉ pour cohérence
        completedCompositions: {},
        lastSaved: new Date().toISOString()
      };
      
      for (const [channelId, clubMap] of this.data.registrations.entries()) {
        jsonData.registrations[channelId] = {};
        for (const [clubId, info] of clubMap.entries()) {
          jsonData.registrations[channelId][clubId] = info;
        }
      }
      
      for (const [channelId, settings] of this.data.channelSettings.entries()) {
        jsonData.channelSettings[channelId] = settings;
      }

      for (const [key, data] of this.data.completedCompositions.entries()) {
        jsonData.completedCompositions[key] = data;
      }

      await fs.writeFile(this.dataFile, JSON.stringify(jsonData, null, 2));
      logger.debug('💾 Données sauvegardées');
      
    } catch (error) {
      logger.error('❌ Erreur sauvegarde:', error);
      throw error;
    }
  }

  // =================== GESTION DES INSCRIPTIONS ===================
  
  registerTeam(channelId, clubId, userId = null) {
    const clubIdStr = clubId.toString();
    
    if (!this.data.registrations.has(channelId)) {
      this.data.registrations.set(channelId, new Map());
    }
    
    const channelClubs = this.data.registrations.get(channelId);
    
    channelClubs.set(clubIdStr, {
      clubId: clubIdStr,
      registeredBy: userId,
      registeredAt: Date.now()
    });
    
    logger.info(`➕ Club ${clubId} inscrit dans le canal ${channelId} par ${userId || 'inconnu'}`);
    return true;
  }
  
  unregisterTeam(channelId, clubId) {
    const clubIdStr = clubId.toString();
    
    if (!this.data.registrations.has(channelId)) {
      return false;
    }
    
    const channelClubs = this.data.registrations.get(channelId);
    const removed = channelClubs.delete(clubIdStr);
    
    if (channelClubs.size === 0) {
      this.data.registrations.delete(channelId);
    }
    
    if (removed) {
      logger.info(`➖ Club ${clubId} retiré du canal ${channelId}`);
    }
    
    return removed;
  }
  
  isTeamRegistered(channelId, clubId) {
    const clubIdStr = clubId.toString();
    const channelClubs = this.data.registrations.get(channelId);
    return channelClubs ? channelClubs.has(clubIdStr) : false;
  }
  
  getChannelClubs(channelId) {
    const channelClubs = this.data.registrations.get(channelId);
    return channelClubs ? Array.from(channelClubs.keys()) : [];
  }
  
  getClubRegistrationInfo(channelId, clubId) {
    const clubIdStr = clubId.toString();
    const channelClubs = this.data.registrations.get(channelId);
    
    if (!channelClubs) return null;
    
    return channelClubs.get(clubIdStr) || null;
  }
  
  getAllRegisteredClubs() {
    const allClubs = new Set();
    for (const clubMap of this.data.registrations.values()) {
      for (const clubId of clubMap.keys()) {
        // Ne garder que les IDs de clubs valides (nombres)
        const clubIdNum = parseInt(clubId);
        if (!isNaN(clubIdNum) && clubIdNum > 0) {
          allClubs.add(clubId);
        } else {
          logger.warn(`⚠️ ID de club invalide ignoré dans getAllRegisteredClubs: "${clubId}"`);
        }
      }
    }
    return Array.from(allClubs);
  }
  
  getChannelsForClub(clubId) {
    const clubIdStr = clubId.toString();
    const channels = [];
    
    for (const [channelId, clubMap] of this.data.registrations.entries()) {
      if (clubMap.has(clubIdStr)) {
        channels.push(channelId);
      }
    }
    
    return channels;
  }

  // =================== PARAMÈTRES DES CANAUX ===================
  
  getChannelSettings(channelId) {
    // Initialiser channelSettings si nécessaire
    if (!this.data.channelSettings) {
      this.data.channelSettings = new Map();
    }
    
    // Récupérer ou créer les settings pour ce canal
    if (!this.data.channelSettings.has(channelId)) {
      this.data.channelSettings.set(channelId, {
        notifications: true,
        language: 'fr',
        timezone: 'Europe/Paris'
      });
    }
    
    return this.data.channelSettings.get(channelId);
  }
  
  setChannelSettings(channelId, settings) {
    // Initialiser channelSettings si nécessaire
    if (!this.data.channelSettings) {
      this.data.channelSettings = new Map();
    }
    
    this.data.channelSettings.set(channelId, {
      ...this.getChannelSettings(channelId),
      ...settings
    });
  }

  // =================== STATISTIQUES ===================
  
  getStats() {
    const totalChannels = this.data.registrations.size;
    const totalClubs = this.getAllRegisteredClubs().length;
    
    let totalRegistrations = 0;
    for (const clubMap of this.data.registrations.values()) {
      totalRegistrations += clubMap.size;
    }
    
    return {
      totalChannels,
      totalClubs,
      totalRegistrations,
      averageClubsPerChannel: totalChannels > 0 ? (totalRegistrations / totalChannels).toFixed(1) : 0
    };
  }
  
  debugRegistrations() {
    logger.debug('=== INSCRIPTIONS DEBUG ===');
    for (const [channelId, clubMap] of this.data.registrations.entries()) {
      const clubs = Array.from(clubMap.keys());
      logger.debug(`Canal ${channelId}: [${clubs.join(', ')}]`);
    }
    logger.debug('=== FIN DEBUG ===');
  }

  // =================== GESTION DES COMPOSITIONS COMPLÉTÉES ===================

  markCompositionCompleted(clubId, matchDate, userId) {
    const key = `${clubId}_${matchDate}`;
    this.data.completedCompositions.set(key, {
      clubId: clubId.toString(),
      matchDate: parseInt(matchDate),
      completedAt: Date.now(),
      completedBy: userId
    });
    logger.info(`✅ Composition marquée complétée: Club ${clubId}, Match ${matchDate}`);
  }

  isCompositionCompleted(clubId, matchDate) {
    const key = `${clubId}_${matchDate}`;
    return this.data.completedCompositions.has(key);
  }

  getCompletedComposition(clubId, matchDate) {
    const key = `${clubId}_${matchDate}`;
    return this.data.completedCompositions.get(key) || null;
  }

  // Nettoyer les compositions complétées pour les matchs passés
  cleanupOldCompositions() {
    const now = Date.now() / 1000; // Convertir en secondes (format timestamp Soccerverse)
    let cleanedCount = 0;

    for (const [key, data] of this.data.completedCompositions.entries()) {
      // Supprimer si le match date de plus de 7 jours
      if (data.matchDate < (now - 7 * 24 * 60 * 60)) {
        this.data.completedCompositions.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`🧹 Nettoyage compositions: ${cleanedCount} entrées supprimées`);
    }

    return cleanedCount;
  }
}

module.exports = DataManager;
