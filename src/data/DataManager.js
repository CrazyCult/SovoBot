const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class DataManager {
  constructor() {
    this.dataFile = path.join(__dirname, '..', '..', 'data', 'bot_data.json');
    this.data = {
      registrations: new Map(), // channelId -> Map(clubId -> {clubId, registeredBy, registeredAt})
      settings: new Map()       // channelId -> settings object
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
      
      if (jsonData.settings) {
        for (const [channelId, settings] of Object.entries(jsonData.settings)) {
          this.data.settings.set(channelId, settings);
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
        settings: {},
        lastSaved: new Date().toISOString()
      };
      
      for (const [channelId, clubMap] of this.data.registrations.entries()) {
        jsonData.registrations[channelId] = {};
        for (const [clubId, info] of clubMap.entries()) {
          jsonData.registrations[channelId][clubId] = info;
        }
      }
      
      for (const [channelId, settings] of this.data.settings.entries()) {
        jsonData.settings[channelId] = settings;
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
        allClubs.add(clubId);
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
    return this.data.settings.get(channelId) || {
      notifications: true,
      language: 'fr',
      timezone: 'Europe/Paris'
    };
  }
  
  setChannelSettings(channelId, settings) {
    this.data.settings.set(channelId, {
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
}

module.exports = DataManager;
