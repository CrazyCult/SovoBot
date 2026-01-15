const axios = require('axios');
const logger = require('../utils/logger');

class GasTrackerService {
  constructor(client, dataManager) {
    this.client = client;
    this.dataManager = dataManager;

    // Configuration API Etherscan
    this.apiKey = process.env.ETHERSCAN_API_KEY;
    this.apiUrl = 'https://api.etherscan.io/v2/api';

    // Intervalle de mise à jour (10 minutes pour respecter les rate limits Discord)
    this.updateInterval = 10 * 60 * 1000;

    // Cache du dernier prix
    this.lastGasPrice = null;
    this.lastUpdate = null;

    // Statistiques
    this.stats = {
      totalUpdates: 0,
      successfulUpdates: 0,
      apiErrors: 0,
      discordErrors: 0
    };

    logger.info('⛽ Service Gas Tracker Polygon initialisé');
  }

  /**
   * Démarre la surveillance automatique du gas
   */
  start() {
    // Première mise à jour après 30 secondes
    setTimeout(() => {
      this.updateAllChannels();
    }, 30000);

    // Puis mise à jour toutes les 10 minutes
    setInterval(() => {
      this.updateAllChannels();
    }, this.updateInterval);

    logger.info('⛽ Surveillance du gas Polygon démarrée (mise à jour toutes les 10 minutes)');
  }

  /**
   * Récupère le prix du gas depuis l'API Etherscan (Polygon)
   */
  async fetchGasPrice() {
    try {
      const response = await axios.get(this.apiUrl, {
        params: {
          chainid: 137,
          module: 'gastracker',
          action: 'gasoracle',
          apikey: this.apiKey
        },
        timeout: 10000
      });

      if (response.data.status === '1' && response.data.result) {
        const result = response.data.result;

        // Utiliser ProposeGasPrice (prix recommandé)
        const gasPrice = parseFloat(result.ProposeGasPrice);

        this.lastGasPrice = gasPrice;
        this.lastUpdate = Date.now();

        logger.debug(`⛽ Prix du gas Polygon: ${gasPrice} Gwei`);

        return {
          gasPrice: gasPrice,
          safeGasPrice: parseFloat(result.SafeGasPrice),
          fastGasPrice: parseFloat(result.FastGasPrice),
          lastBlock: result.LastBlock
        };
      } else {
        throw new Error('Réponse API invalide');
      }

    } catch (error) {
      this.stats.apiErrors++;
      logger.error('❌ Erreur récupération prix du gas:', error.message);
      throw error;
    }
  }

  /**
   * Met à jour tous les salons configurés
   */
  async updateAllChannels() {
    try {
      const gasData = await this.fetchGasPrice();
      const gasPrice = gasData.gasPrice;

      // Parcourir tous les serveurs et salons configurés
      for (const [channelId, settings] of this.dataManager.data.channelSettings.entries()) {
        if (settings.gasTracking && settings.gasTracking.enabled) {
          await this.updateChannel(channelId, gasPrice);
        }
      }

      this.stats.totalUpdates++;
      this.stats.successfulUpdates++;

    } catch (error) {
      logger.error('❌ Erreur mise à jour globale gas:', error);
    }
  }

  /**
   * Met à jour le nom d'un salon spécifique
   */
  async updateChannel(channelId, gasPrice) {
    try {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel) {
        logger.warn(`⚠️ Salon ${channelId} introuvable pour mise à jour gas`);
        return false;
      }

      // Format du nom personnalisable
      const settings = this.dataManager.getChannelSettings(channelId);
      const format = settings.gasTracking?.format || '⛽│Gas: {price} Gwei';

      const newName = format.replace('{price}', Math.round(gasPrice));

      // Vérifier si le nom a changé (évite les requêtes inutiles)
      if (channel.name !== newName) {
        await channel.setName(newName, 'Mise à jour automatique du prix du gas Polygon');
        logger.info(`✅ Salon ${channel.name} mis à jour: ${newName}`);
        return true;
      } else {
        logger.debug(`ℹ️ Pas de changement nécessaire pour ${channel.name}`);
        return false;
      }

    } catch (error) {
      this.stats.discordErrors++;

      if (error.code === 50013) {
        logger.error(`❌ Permissions insuffisantes pour modifier le salon ${channelId}`);
      } else if (error.code === 50035) {
        logger.error(`❌ Rate limit Discord atteint pour le salon ${channelId}`);
      } else {
        logger.error(`❌ Erreur mise à jour salon ${channelId}:`, error.message);
      }

      return false;
    }
  }

  /**
   * Active le tracking du gas pour un salon
   */
  enableTracking(channelId, format = '⛽│Gas: {price} Gwei') {
    const settings = this.dataManager.getChannelSettings(channelId);

    if (!settings.gasTracking) {
      settings.gasTracking = {};
    }

    settings.gasTracking.enabled = true;
    settings.gasTracking.format = format;
    settings.gasTracking.enabledAt = Date.now();

    logger.info(`✅ Tracking gas activé pour le salon ${channelId}`);

    // Mise à jour immédiate
    if (this.lastGasPrice) {
      this.updateChannel(channelId, this.lastGasPrice);
    }
  }

  /**
   * Désactive le tracking du gas pour un salon
   */
  disableTracking(channelId) {
    const settings = this.dataManager.getChannelSettings(channelId);

    if (settings.gasTracking) {
      settings.gasTracking.enabled = false;
      logger.info(`🛑 Tracking gas désactivé pour le salon ${channelId}`);
    }
  }

  /**
   * Obtient le statut du tracking
   */
  getStatus() {
    const enabledChannels = [];

    for (const [channelId, settings] of this.dataManager.data.channelSettings.entries()) {
      if (settings.gasTracking && settings.gasTracking.enabled) {
        enabledChannels.push({
          channelId,
          format: settings.gasTracking.format,
          enabledAt: settings.gasTracking.enabledAt
        });
      }
    }

    return {
      enabled: enabledChannels.length > 0,
      channelCount: enabledChannels.length,
      channels: enabledChannels,
      lastGasPrice: this.lastGasPrice,
      lastUpdate: this.lastUpdate,
      stats: this.stats
    };
  }

  /**
   * Force une mise à jour manuelle
   */
  async forceUpdate() {
    logger.info('🔄 Mise à jour manuelle du gas demandée');
    await this.updateAllChannels();
  }
}

module.exports = GasTrackerService;
