const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class DataManager {
  constructor() {
    this.dataFile = path.join(__dirname, '..', '..', 'data', 'bot_data.json');
    this.data = {
      registrations: new Map(), // channelId -> Set(clubIds)
      settings: new Map()       // channelId -> settings object
    };
  }

  // =================== CHARGEMENT/SAUVEGARDE ===================
  
  async load() {
    try {
      // Créer le dossier data s'il n'existe pas
      const dataDir = path.dirname(this.dataFile);
      await fs.mkdir(dataDir, { recursive: true });
      
      // Vérifier si le fichier existe
      try {
        await fs.access(this.dataFile);
      } catch (error) {
        // Fichier n'existe pas, créer avec des données vides
        logger.info('📄 Création du fichier de données');
        await this.save();
        return;
      }
      
      // Charger le fichier existant
      const fileContent = await fs.readFile(this.dataFile, 'utf8');
      const jsonData = JSON.parse(fileContent);
      
      // Convertir les objets en Maps/Sets
      if (jsonData.registrations) {
        for (const [channelId, clubIds] of Object.entries(jsonData.registrations)) {
          this.data.registrations.set(channelId, new Set(clubIds));
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
      // Continuer avec des données vides
    }
  }
  
  async save() {
    try {
      // Convertir Maps/Sets en objets pour JSON
      const jsonData = {
        registrations: {},
        settings: {},
        lastSaved: new Date().toISOString()
      };
      
      for (const [channelId, clubSet] of this.data.registrations.entries()) {
        jsonData.registrations[channelId] = Array.from(clubSet);
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
  
  registerTeam(channelId, clubId) {
    const clubIdStr = clubId.toString();
    
    if (!this.data.registrations.has(channelId)) {
      this.data.registrations.set(channelId, new Set());
    }
    
    const channelClubs = this.data.registrations.get(channelId);
    channelClubs.add(clubIdStr);
    
    logger.info(`➕ Club ${clubId} inscrit dans le canal ${channelId}`);
    return true;
  }
  
  unregisterTeam(channelId, clubId) {
    const clubIdStr = clubId.toString();
    
    if (!this.data.registrations.has(channelId)) {
      return false;
    }
    
    const channelClubs = this.data.registrations.get(channelId);
    const removed = channelClubs.delete(clubIdStr);
    
    // Supprimer le canal s'il n'y a plus de clubs
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
    return channelClubs ? Array.from(channelClubs) : [];
  }
  
  getAllRegisteredClubs() {
    const allClubs = new Set();
    for (const clubSet of this.data.registrations.values()) {
      for (const clubId of clubSet) {
        allClubs.add(clubId);
      }
    }
    return Array.from(allClubs);
  }
  
  getChannelsForClub(clubId) {
    const clubIdStr = clubId.toString();
    const channels = [];
    
    for (const [channelId, clubSet] of this.data.registrations.entries()) {
      if (clubSet.has(clubIdStr)) {
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
    for (const clubSet of this.data.registrations.values()) {
      totalRegistrations += clubSet.size;
    }
    
    return {
      totalChannels,
      totalClubs,
      totalRegistrations,
      averageClubsPerChannel: totalChannels > 0 ? (totalRegistrations / totalChannels).toFixed(1) : 0
    };
  }
  
  // Debug: Afficher toutes les inscriptions
  debugRegistrations() {
    logger.debug('=== INSCRIPTIONS DEBUG ===');
    for (const [channelId, clubSet] of this.data.registrations.entries()) {
      logger.debug(`Canal ${channelId}: [${Array.from(clubSet).join(', ')}]`);
    }
    logger.debug('=== FIN DEBUG ===');
  }
}

module.exports = DataManager;