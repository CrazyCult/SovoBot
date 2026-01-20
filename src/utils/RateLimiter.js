const logger = require('./logger');

/**
 * Rate Limiter Global avec Queue
 * Limite à 3 requêtes par seconde maximum
 */
class RateLimiter {
  constructor(maxRequestsPerSecond = 3) {
    this.maxRequests = maxRequestsPerSecond;
    this.queue = [];
    this.requestTimestamps = [];
    this.processing = false;
    
    // Statistiques
    this.stats = {
      totalRequests: 0,
      queuedRequests: 0,
      rejectedRequests: 0,
      averageWaitTime: 0,
      maxQueueSize: 0,
      currentQueueSize: 0
    };
    
    // Nettoyer les vieux timestamps toutes les 5 secondes
    setInterval(() => {
      this.cleanOldTimestamps();
    }, 5000);
    
    logger.info(`⏱️ Rate Limiter initialisé: max ${this.maxRequests} requêtes/seconde`);
  }

  /**
   * Nettoie les timestamps de plus d'1 seconde
   */
  cleanOldTimestamps() {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    
    this.requestTimestamps = this.requestTimestamps.filter(
      timestamp => timestamp > oneSecondAgo
    );
  }

  /**
   * Vérifie si on peut faire une requête maintenant
   */
  canMakeRequest() {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    
    // Compter les requêtes dans la dernière seconde
    const recentRequests = this.requestTimestamps.filter(
      timestamp => timestamp > oneSecondAgo
    );
    
    return recentRequests.length < this.maxRequests;
  }

  /**
   * Enregistre une nouvelle requête
   */
  recordRequest() {
    const now = Date.now();
    this.requestTimestamps.push(now);
    this.stats.totalRequests++;
  }

  /**
   * Calcule le délai d'attente optimal
   */
  getWaitTime() {
    if (this.requestTimestamps.length === 0) {
      return 0;
    }
    
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    
    // Trouver les requêtes dans la dernière seconde
    const recentRequests = this.requestTimestamps.filter(
      timestamp => timestamp > oneSecondAgo
    ).sort((a, b) => a - b);
    
    if (recentRequests.length < this.maxRequests) {
      return 0;
    }
    
    // Le plus vieux timestamp + 1 seconde - maintenant
    const oldestRequest = recentRequests[0];
    const waitTime = (oldestRequest + 1000) - now;
    
    return Math.max(0, waitTime);
  }

  /**
   * Traite la queue
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      // Vérifier si on peut traiter
      if (this.canMakeRequest()) {
        const item = this.queue.shift();
        this.stats.currentQueueSize = this.queue.length;
        
        try {
          this.recordRequest();
          const result = await item.fn();
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        }
      } else {
        // Attendre le temps nécessaire
        const waitTime = this.getWaitTime();
        
        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, waitTime + 10));
        }
      }
    }
    
    this.processing = false;
  }

  /**
   * Exécute une fonction avec rate limiting
   * @param {Function} fn - Fonction async à exécuter
   * @param {string} description - Description de la requête (pour logs)
   * @returns {Promise} - Résultat de la fonction
   */
  async execute(fn, description = 'API call') {
    return new Promise((resolve, reject) => {
      const queuedAt = Date.now();
      
      // Ajouter à la queue
      this.queue.push({
        fn,
        description,
        queuedAt,
        resolve,
        reject
      });
      
      this.stats.queuedRequests++;
      this.stats.currentQueueSize = this.queue.length;
      
      // Mettre à jour le max
      if (this.queue.length > this.stats.maxQueueSize) {
        this.stats.maxQueueSize = this.queue.length;
      }
      
      // Logger si la queue devient importante
      if (this.queue.length > 10) {
        logger.warn(`⚠️ Rate Limiter: Queue importante (${this.queue.length} requêtes en attente)`);
      }
      
      // Démarrer le traitement
      this.processQueue().catch(err => {
        logger.error('Erreur traitement queue:', err);
      });
    });
  }

  /**
   * Récupère les statistiques
   */
  getStats() {
    const recentRequests = this.requestTimestamps.filter(
      timestamp => timestamp > Date.now() - 1000
    );
    
    return {
      ...this.stats,
      currentRate: recentRequests.length,
      maxRate: this.maxRequests,
      utilization: `${Math.round((recentRequests.length / this.maxRequests) * 100)}%`
    };
  }

  /**
   * Réinitialise les statistiques
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      queuedRequests: 0,
      rejectedRequests: 0,
      averageWaitTime: 0,
      maxQueueSize: 0,
      currentQueueSize: this.queue.length
    };
    
    logger.info('📊 Statistiques Rate Limiter réinitialisées');
  }

  /**
   * Vide la queue (annule toutes les requêtes en attente)
   */
  clearQueue() {
    const count = this.queue.length;
    
    // Rejeter toutes les requêtes en attente
    for (const item of this.queue) {
      item.reject(new Error('Queue cleared by system'));
    }
    
    this.queue = [];
    this.stats.currentQueueSize = 0;
    
    logger.warn(`🗑️ Queue vidée: ${count} requête(s) annulée(s)`);
    
    return count;
  }
}

module.exports = RateLimiter;
