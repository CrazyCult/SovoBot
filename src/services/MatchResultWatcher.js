const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../utils/logger');

class MatchResultWatcher {
  constructor(client, dataManager, apiClient) {
    this.client = client;
    this.dataManager = dataManager;
    this.apiClient = apiClient;
    
    // Cache des matchs à venir par club
    this.upcomingMatchesCache = new Map(); // clubId -> [matches]
    this.lastCacheUpdate = null;
    
    // Matchs déjà traités (pour éviter doublons)
    this.processedMatches = this.loadProcessedMatches();
    
    // Timers programmés pour chaque match
    this.scheduledChecks = new Map(); // matchKey -> timeoutId
    
    // Configuration retry
    this.maxRetries = 3;
    this.retryDelays = [15000, 30000, 60000]; // 15s, 30s, 60s
    this.matchCheckDelay = 15 * 1000; // 15 secondes après l'heure du match
    
    // Statistiques
    this.stats = {
      totalMatches: 0,
      successfulChecks: 0,
      failedChecks: 0,
      cacheUpdates: 0
    };
    
    this.startWatching();
  }

  // =================== DÉMARRAGE ===================
  
  startWatching() {
    // 1. Charger le cache immédiatement au démarrage
    setTimeout(async () => {
      logger.info('⚽ Chargement initial du cache des matchs...');
      await this.updateMatchCache();
      this.scheduleAllMatches();
    }, 10000); // 10 secondes après le démarrage
    
    // 2. Programmer la mise à jour quotidienne à 3h du matin
    this.scheduleDailyUpdate();
    
    // 3. Sauvegarder les matchs traités toutes les 10 minutes
    setInterval(() => {
      this.saveProcessedMatches();
    }, 10 * 60 * 1000);
    
    // ✅ Scan de rattrapage toutes les 5 minutes
    setInterval(async () => {
      await this.scanMissedResults();
    }, 5 * 60 * 1000);

    // Premier scan 2 minutes après démarrage
    setTimeout(async () => {
      await this.scanMissedResults();
    }, 2 * 60 * 1000);

    logger.info('⚽ Surveillance résultats optimisée démarrée');
    logger.info('   📅 Cache : Mise à jour quotidienne à 3h00');
    logger.info('   ⏰ Vérifications : Heure du match + 15s + scan rattrapage toutes les 5min');
  }

  // =================== MISE À JOUR DU CACHE (1x/JOUR à 3h) ===================
  
  scheduleDailyUpdate() {
    const now = new Date();
    const next3AM = new Date();
    next3AM.setHours(3, 0, 0, 0);
    
    // Si on est déjà passé 3h aujourd'hui, programmer pour demain
    if (now > next3AM) {
      next3AM.setDate(next3AM.getDate() + 1);
    }
    
    const timeUntil3AM = next3AM - now;
    
    logger.info(`📅 Prochaine mise à jour du cache programmée à ${next3AM.toLocaleString('fr-FR')}`);
    
    setTimeout(async () => {
      logger.info('🌙 Mise à jour nocturne du cache des matchs (3h00)...');
      await this.updateMatchCache();
      this.scheduleAllMatches();
      
      // Reprogrammer pour le lendemain
      this.scheduleDailyUpdate();
    }, timeUntil3AM);
  }

  async updateMatchCache() {
    try {
      logger.info('🔄 Mise à jour du cache des matchs...');
      
      const registeredClubs = this.dataManager.getAllRegisteredClubs();
      const now = Date.now() / 1000;
      const next7Days = now + (7 * 24 * 60 * 60); // 7 jours
      
      logger.debug(`🔍 Paramètres de filtrage:`);
      logger.debug(`  - Timestamp actuel: ${now} (${new Date(now * 1000).toLocaleString('fr-FR')})`);
      logger.debug(`  - Fenêtre 7 jours: ${next7Days} (${new Date(next7Days * 1000).toLocaleString('fr-FR')})`);
      logger.debug(`  - Clubs inscrits: ${registeredClubs.length}`);
      
      let totalMatches = 0;
      
      for (const clubId of registeredClubs) {
        try {
          // Récupérer les prochains matchs du club
          logger.debug(`🔍 Récupération matchs pour club ${clubId}...`);
          const nextMatch = await this.apiClient.getClubNextMatch(parseInt(clubId));
          const matches = nextMatch ? [nextMatch] : [];
          
          // ✅ DEBUG: Afficher ce que l'API retourne
          logger.debug(`  📥 API retourne ${matches.length} match(s) pour club ${clubId}`);
          
          if (matches.length > 0) {
            // Afficher les détails du premier match
            const firstMatch = matches[0];
            logger.debug(`  🔍 Premier match reçu:`);
            logger.debug(`     - Date: ${firstMatch.date} (${new Date(firstMatch.date * 1000).toLocaleString('fr-FR')})`);
            logger.debug(`     - Played: ${firstMatch.played}`);
            logger.debug(`     - Home: ${firstMatch.home_club} vs Away: ${firstMatch.away_club}`);
            logger.debug(`     - Dans le futur? ${firstMatch.date > now}`);
            logger.debug(`     - Dans les 7 jours? ${firstMatch.date < next7Days}`);
            logger.debug(`     - Non joué? ${firstMatch.played === 0}`);
          }
          
          // Filtrer pour garder seulement les matchs à venir (7 prochains jours max)
          const upcomingMatches = matches.filter(match => 
            match.date > now && 
            match.date < next7Days && 
            match.played === 0 || match.played === undefined
          );
          
          // ✅ DEBUG: Résultat du filtrage
          logger.debug(`  ✅ Après filtrage: ${upcomingMatches.length} match(s) conservé(s)`);
          
          if (upcomingMatches.length > 0) {
            this.upcomingMatchesCache.set(clubId, upcomingMatches);
            totalMatches += upcomingMatches.length;
            
            logger.debug(`📌 Club ${clubId}: ${upcomingMatches.length} match(s) à venir ajouté(s) au cache`);
            
            // Afficher tous les matchs conservés
            upcomingMatches.forEach((match, index) => {
              logger.debug(`   ${index + 1}. ${new Date(match.date * 1000).toLocaleString('fr-FR')}`);
            });
          } else {
            // Retirer du cache si plus de matchs à venir
            this.upcomingMatchesCache.delete(clubId);
            logger.debug(`⚠️ Club ${clubId}: Aucun match dans les 7 jours, retiré du cache`);
          }
          
          // Délai entre chaque club pour éviter de surcharger l'API
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          logger.error(`❌ Erreur récupération calendrier club ${clubId}:`, error.message);
        }
      }
      
      this.lastCacheUpdate = Date.now();
      this.stats.cacheUpdates++;
      
      logger.info(`✅ Cache mis à jour: ${totalMatches} match(s) programmé(s) pour ${registeredClubs.length} club(s)`);
      logger.debug(`📊 Taille du cache: ${this.upcomingMatchesCache.size} club(s) avec matchs`);
      
      // Sauvegarder le cache
      await this.saveMatchCache();
      if (this.onCacheReady) this.onCacheReady();
      
    } catch (error) {
      logger.error('❌ Erreur mise à jour cache matchs:', error);
    }
  }

  // =================== SCHEDULING DES VÉRIFICATIONS ===================
  
  scheduleAllMatches() {
    // Annuler tous les timers existants
    for (const timeoutId of this.scheduledChecks.values()) {
      clearTimeout(timeoutId);
    }
    this.scheduledChecks.clear();
    
    const now = Date.now() / 1000;
    let scheduledCount = 0;
    
    logger.debug(`🔄 Programmation des vérifications de résultats...`);
    logger.debug(`   Cache contient ${this.upcomingMatchesCache.size} club(s)`);
    
    for (const [clubId, matches] of this.upcomingMatchesCache.entries()) {
      logger.debug(`  📋 Club ${clubId}: ${matches.length} match(s) à programmer`);
      
      for (const match of matches) {
        const matchKey = this.generateMatchKey(clubId, match);
        
        // Skip si déjà traité
        if (this.processedMatches.has(matchKey)) {
          logger.debug(`     ⏭️ Match déjà traité (skip): ${matchKey}`);
          continue;
        }
        
        // Calculer quand vérifier (heure du match + 15 secondes)
        const checkTime = match.date + 15; // 15 secondes après l'heure du match
        const delayMs = (checkTime - now) * 1000;
        
        // Ne programmer que si c'est dans le futur
        if (delayMs > 0) {
          const timeoutId = setTimeout(async () => {
            await this.checkMatchResult(clubId, match, 0);
          }, delayMs);
          
          this.scheduledChecks.set(matchKey, timeoutId);
          scheduledCount++;
          
          const matchDate = new Date(match.date * 1000);
          const checkDate = new Date(checkTime * 1000);
          logger.debug(`     ⏰ Programmé: ${matchDate.toLocaleString('fr-FR')} → Vérif: ${checkDate.toLocaleString('fr-FR')}`);
        } else {
          // Match dans le passé mais pas encore vérifié
          logger.warn(`     ⚠️ Match passé non vérifié: ${new Date(match.date * 1000).toLocaleString('fr-FR')}`);
          
          // Vérifier immédiatement
          setTimeout(async () => {
            await this.checkMatchResult(clubId, match, 0);
          }, 5000); // Dans 5 secondes
        }
      }
    }
    
    logger.info(`⏰ ${scheduledCount} vérification(s) de résultat programmée(s)`);
  }

  // =================== VÉRIFICATION AVEC RETRY ===================
  
  async checkMatchResult(clubId, match, retryAttempt = 0) {
    const matchKey = this.generateMatchKey(clubId, match);
    
    // Vérifier si déjà traité (au cas où)
    if (this.processedMatches.has(matchKey)) {
      logger.debug(`Match déjà traité: ${matchKey}`);
      return;
    }
    
    try {
      const attemptLabel = retryAttempt === 0 ? 'initiale' : `retry ${retryAttempt}`;
      logger.info(`⚽ Vérification résultat Club ${clubId} (tentative ${attemptLabel})...`);
      
      // Récupérer le dernier match du club
      const lastMatch = await this.apiClient.getClubLastMatch(parseInt(clubId));
      
      if (!lastMatch) {
        throw new Error('Aucun match trouvé');
      }
      
      // Vérifier que c'est bien le bon match
      const isCorrectMatch = this.isMatchingFixture(lastMatch, match);
      
      if (!isCorrectMatch) {
        logger.warn(`⚠️ Match trouvé ne correspond pas au match attendu pour club ${clubId}`);
        logger.debug(`   Attendu: ${match.home_club} vs ${match.away_club} à ${new Date(match.date * 1000).toLocaleString('fr-FR')}`);
        logger.debug(`   Trouvé: ${lastMatch.home_club} vs ${lastMatch.away_club} à ${new Date(lastMatch.date * 1000).toLocaleString('fr-FR')}`);
        throw new Error('Match différent');
      }
      
      // Vérifier que le match est bien terminé
      if (lastMatch.played !== 1) {
        logger.warn(`⚠️ Match pas encore terminé (played=${lastMatch.played})`);
        throw new Error('Match non terminé');
      }
      
      // ✅ Match terminé ! Envoyer la notification
      await this.sendMatchResult(clubId, lastMatch);
      
      // Marquer comme traité
      this.processedMatches.set(matchKey, {
        timestamp: Date.now(),
        clubId: clubId,
        matchId: lastMatch.fixture_id || lastMatch.match_id,
        homeGoals: lastMatch.home_goals,
        awayGoals: lastMatch.away_goals,
        date: lastMatch.date
      });
      
      this.stats.successfulChecks++;
      this.stats.totalMatches++;
      await this.saveProcessedMatches();
      
      logger.info(`✅ Résultat traité avec succès: Club ${clubId} - ${lastMatch.home_goals}-${lastMatch.away_goals}`);
      
      // Retirer du cache et du scheduling
      this.scheduledChecks.delete(matchKey);
      
    } catch (error) {
      logger.error(`❌ Erreur vérification match club ${clubId} (tentative ${retryAttempt + 1}/${this.maxRetries + 1}):`, error.message);
      
      // Retry si on n'a pas atteint le max
      if (retryAttempt < this.maxRetries) {
        const retryDelay = this.retryDelays[retryAttempt];
        
        logger.info(`🔄 Retry programmé dans ${retryDelay/1000}s pour club ${clubId} (tentative ${retryAttempt + 2}/${this.maxRetries + 1})`);
        
        setTimeout(async () => {
          await this.checkMatchResult(clubId, match, retryAttempt + 1);
        }, retryDelay);
        
      } else {
        logger.error(`❌ Échec définitif après ${this.maxRetries + 1} tentatives pour club ${clubId}`);
        this.stats.failedChecks++;
        
        // Marquer quand même comme traité pour éviter de réessayer indéfiniment
        this.processedMatches.set(matchKey, {
          timestamp: Date.now(),
          clubId: clubId,
          failed: true,
          error: error.message,
          attempts: retryAttempt + 1
        });
        await this.saveProcessedMatches();
        
        // Retirer du scheduling
        this.scheduledChecks.delete(matchKey);
      }
    }
  }

  // =================== UTILITAIRES ===================
  
  generateMatchKey(clubId, match) {
    // Utiliser l'ID du match si disponible
    const matchId = match.fixture_id || match.match_id || match.id;
    
    if (matchId) {
      return `${clubId}_${matchId}`;
    }
    
    // Fallback: date + équipes (arrondir à la minute pour éviter les différences de secondes)
    const dateKey = Math.floor(match.date / 60);
    const homeClub = match.home_club || 0;
    const awayClub = match.away_club || 0;
    return `${clubId}_${dateKey}_${homeClub}_${awayClub}`;
  }

  isMatchingFixture(lastMatch, expectedMatch) {
    // Vérifier par ID si disponible
    const lastMatchId = lastMatch.fixture_id || lastMatch.match_id;
    const expectedMatchId = expectedMatch.fixture_id || expectedMatch.match_id;
    
    if (lastMatchId && expectedMatchId) {
      return lastMatchId === expectedMatchId;
    }
    
    // Fallback: vérifier date + équipes
    const dateDiff = Math.abs(lastMatch.date - expectedMatch.date);
    const sameTeams = (
      lastMatch.home_club === expectedMatch.home_club &&
      lastMatch.away_club === expectedMatch.away_club
    );
    
    // Date doit être dans la même heure et mêmes équipes
    return dateDiff < 3600 && sameTeams;
  }

  async sendMatchResult(clubId, match) {
    try {
      const channels = this.dataManager.getChannelsForClub(clubId);
      if (channels.length === 0) {
        logger.debug(`Aucun canal pour le club ${clubId}, skip notification`);
        return;
      }
      const isHome = match.home_club == clubId;
      const opponentId = isHome ? match.away_club : match.home_club;
      const opponentName = this.apiClient.getClubName(opponentId);
      const clubName = this.apiClient.getClubName(clubId);
      const myGoals = isHome ? match.home_goals : match.away_goals;
      const oppGoals = isHome ? match.away_goals : match.home_goals;
      let resultEmoji = "⚪";
      let resultText = "Match nul";
      let embedColor = "#FFA500";
      if (myGoals > oppGoals) { resultEmoji = "✅"; resultText = "Victoire !"; embedColor = "#4CAF50"; }
      else if (myGoals < oppGoals) { resultEmoji = "❌"; resultText = "Defaite"; embedColor = "#FF6B6B"; }
      const venue = isHome ? "🏟️ Domicile" : "✈️ Exterieur";
      let fixtureData = null;
      let subsData = [];
      try {
        const fixtureId = match.fixture_id || match.match_id;
        if (fixtureId) {
          const [fixtureRes, subsRes] = await Promise.all([
            this.apiClient.makeRpcRequest("get_fixture", { fixture_id: fixtureId }),
            this.apiClient.makeRpcRequest("get_match_subs", { fixture_id: fixtureId })
          ]);
          const fArr = fixtureRes?.data || (Array.isArray(fixtureRes) ? fixtureRes : [fixtureRes]);
          fixtureData = fArr[0] || null;
          subsData = Array.isArray(subsRes) ? subsRes : [];
        }
      } catch (e) { logger.warn("Stats detaillees non disponibles:", e.message); }
      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`${resultEmoji} ${resultText} — ${clubName}`)
        .setDescription(`**${clubName}** ${myGoals} - ${oppGoals} **${opponentName}**`)
        .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`)
        .setFooter({ text: "Soccerverse Bot v3.0 • Resultat du match" })
        .setTimestamp();
      embed.addFields({ name: "📍 Lieu", value: venue, inline: true });
      if (fixtureData) {
        const myPoss = isHome ? fixtureData.home_possession : fixtureData.away_possession;
        const oppPoss = isHome ? fixtureData.away_possession : fixtureData.home_possession;
        const myShots = isHome ? fixtureData.home_shots : fixtureData.away_shots;
        const oppShots = isHome ? fixtureData.away_shots : fixtureData.home_shots;
        const mySOT = isHome ? fixtureData.home_shots_on_target : fixtureData.away_shots_on_target;
        const oppSOT = isHome ? fixtureData.away_shots_on_target : fixtureData.home_shots_on_target;
        const myCorners = isHome ? fixtureData.home_corners : fixtureData.away_corners;
        const oppCorners = isHome ? fixtureData.away_corners : fixtureData.home_corners;
        const attendance = fixtureData.attendance || 0;
        if (myPoss !== undefined) embed.addFields({ name: "📊 Possession", value: `**${myPoss}%** - ${oppPoss}%`, inline: true });
        if (myShots !== undefined) embed.addFields({ name: "🎯 Tirs (cadres)", value: `**${myShots} (${mySOT})** - ${oppShots} (${oppSOT})`, inline: true });
        if (myCorners !== undefined) embed.addFields({ name: "🚩 Corners", value: `**${myCorners}** - ${oppCorners}`, inline: true });
        if (attendance > 0) embed.addFields({ name: "🏟️ Affluence", value: `${attendance.toLocaleString("fr-FR")} spectateurs`, inline: true });
        if (fixtureData.man_of_match) {
          const momName = this.apiClient.getPlayerName(fixtureData.man_of_match) || `Joueur #${fixtureData.man_of_match}`;
          embed.addFields({ name: "⭐ Man of the Match", value: momName, inline: true });
        }
      }
      if (subsData.length > 0) {
        const mySubs = subsData.filter(s => s.club_id == clubId);
        if (mySubs.length > 0) {
          const lines = mySubs.map(s => {
            const nameOn = this.apiClient.getPlayerName(s.player_on_id) || `#${s.player_on_id}`;
            const nameOff = this.apiClient.getPlayerName(s.player_off_id) || `#${s.player_off_id}`;
            return `↑ ${nameOn} / ↓ ${nameOff} (${s.time}')`;
          });
          embed.addFields({ name: "🔄 Remplacements", value: lines.join("\n"), inline: false });
        }
      }
      // Bouton classement
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`classement_${clubId}`)
          .setLabel('📊 Classement')
          .setStyle(ButtonStyle.Secondary)
      );

      for (const channelId of channels) {
        try {
          const channel = await this.client.channels.fetch(channelId);
          await channel.send({ embeds: [embed], components: [row] });
          logger.info(`Resultat envoye: ${clubName} ${myGoals}-${oppGoals}`);
        } catch (error) { logger.error(`Erreur canal ${channelId}:`, error.message); }
      }
    } catch (error) { logger.error("Erreur sendMatchResult:", error); }
  }

  
  // =================== SCAN DE RATTRAPAGE ===================
  async scanMissedResults() {
    try {
      const registeredClubs = this.dataManager.getAllRegisteredClubs();
      const now = Date.now() / 1000;
      const todayStart = now - (12 * 60 * 60); // 3 dernières heures

      for (const clubId of registeredClubs) {
        try {
          const lastMatch = await this.apiClient.getClubLastMatch(parseInt(clubId));
          if (!lastMatch) continue;

          // Match joué aujourd'hui ?
          if (lastMatch.played !== 1) continue;
          if (lastMatch.date < todayStart) continue;

          const matchKey = this.generateMatchKey(clubId, lastMatch);
          if (this.processedMatches.has(matchKey)) continue;

          logger.info(`🔍 Résultat manqué détecté: Club ${clubId} - match du ${new Date(lastMatch.date * 1000).toLocaleString('fr-FR')}`);
          await this.sendMatchResult(clubId, lastMatch);

          this.processedMatches.set(matchKey, {
            timestamp: Date.now(),
            clubId: clubId,
            matchId: lastMatch.fixture_id,
            homeGoals: lastMatch.home_goals,
            awayGoals: lastMatch.away_goals,
            date: lastMatch.date,
            source: 'scan_rattrapage'
          });
          await this.saveProcessedMatches();

          // Délai entre les clubs pour ne pas surcharger l'API
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (e) {
          // Silencieux pour ne pas spammer les logs
        }
      }
    } catch (error) {
      logger.error('❌ Erreur scan rattrapage:', error.message);
    }
  }

  // =================== PERSISTENCE ===================
  
  loadProcessedMatches() {
    try {
      const settings = this.dataManager.getChannelSettings('_global_results');
      
      if (settings && settings.processedMatches) {
        const map = new Map();
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        
        for (const [key, data] of Object.entries(settings.processedMatches)) {
          if (data.timestamp > thirtyDaysAgo) {
            map.set(key, data);
          }
        }
        
        logger.info(`📦 ${map.size} match(s) déjà traité(s) chargé(s) depuis le cache`);
        return map;
      }
    } catch (error) {
      logger.warn('⚠️ Impossible de charger le cache des matchs:', error.message);
    }
    
    return new Map();
  }

  async saveProcessedMatches() {
    try {
      const processedMatchesObj = {};
      for (const [key, data] of this.processedMatches.entries()) {
        processedMatchesObj[key] = data;
      }
      
      this.dataManager.setChannelSettings('_global_results', {
        processedMatches: processedMatchesObj,
        lastSaved: Date.now()
      });
      
      await this.dataManager.save();
      logger.debug(`💾 ${this.processedMatches.size} match(s) traité(s) sauvegardé(s)`);
    } catch (error) {
      logger.error('❌ Erreur sauvegarde matchs traités:', error);
    }
  }

  async saveMatchCache() {
    try {
      const cacheObj = {};
      for (const [clubId, matches] of this.upcomingMatchesCache.entries()) {
        cacheObj[clubId] = matches;
      }
      
      this.dataManager.setChannelSettings('_global_match_cache', {
        upcomingMatches: cacheObj,
        lastUpdate: this.lastCacheUpdate
      });
      
      await this.dataManager.save();
      logger.debug(`💾 Cache matchs sauvegardé`);
    } catch (error) {
      logger.error('❌ Erreur sauvegarde cache matchs:', error);
    }
  }

  // =================== STATISTIQUES & DEBUG ===================
  
  getStats() {
    return {
      ...this.stats,
      cachedClubs: this.upcomingMatchesCache.size,
      totalCachedMatches: Array.from(this.upcomingMatchesCache.values())
        .reduce((sum, matches) => sum + matches.length, 0),
      scheduledChecks: this.scheduledChecks.size,
      processedMatches: this.processedMatches.size,
      lastCacheUpdate: this.lastCacheUpdate ?
        new Date(this.lastCacheUpdate).toLocaleString('fr-FR') : 'Jamais'
    };
  }

  getResultStats() {
    return {
      method: 'Cache + programmation précise',
      resultDelay: '15 secondes',
      schedulingInterval: '1x/jour à 3h',
      processedMatchesCount: this.processedMatches.size,
      cacheSize: this.upcomingMatchesCache.size,
      scheduledChecksCount: this.scheduledChecks.size,
      stats: this.stats
    };
  }

  resetResultCache() {
    this.processedMatches.clear();
    logger.info('🔄 Cache des résultats réinitialisé');
  }

  getNextMatches(limit = 10) {
    const allMatches = [];
    
    for (const [clubId, matches] of this.upcomingMatchesCache.entries()) {
      for (const match of matches) {
        allMatches.push({
          clubId: clubId,
          clubName: this.apiClient.getClubName(clubId),
          matchDate: new Date(match.date * 1000),
          homeClub: match.home_club_name,
          awayClub: match.away_club_name,
          checkTime: new Date((match.date + 15) * 1000)
        });
      }
    }
    
    // Trier par date
    allMatches.sort((a, b) => a.matchDate - b.matchDate);
    
    return allMatches.slice(0, limit);
  }
}

module.exports = MatchResultWatcher;
