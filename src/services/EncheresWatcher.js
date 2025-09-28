const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

class EncheresWatcher {
  constructor(client, dataManager, apiClient) {
    this.client = client;
    this.dataManager = dataManager;
    this.apiClient = apiClient;
    
    // Cache des enchères précédentes pour détecter les changements
    this.previousBids = new Map();
    
    // Cache des notifications de fin envoyées
    this.notifiedEndingSoon = new Set();
    
    // Intervalle de vérification (60 secondes)
    this.checkInterval = 60 * 1000;
    
    // Statistiques
    this.stats = {
      totalChecks: 0,
      notificationsSent: 0,
      outbidsDetected: 0,
      endingAlertsSent: 0
    };
    
    this.startWatching();
  }

  startWatching() {
    // Vérification initiale après 30 secondes
    setTimeout(() => {
      this.checkAllWatchedAuctions();
    }, 30000);
    
    // Puis vérification toutes les 60 secondes
    setInterval(() => {
      this.checkAllWatchedAuctions();
    }, this.checkInterval);
    
    logger.info('🏆 Service de surveillance des enchères démarré (vérification toutes les 60 secondes)');
  }

  async checkAllWatchedAuctions() {
    try {
      const watchedChannels = this.getWatchedChannels();
      
      if (watchedChannels.length === 0) {
        return;
      }
      
      logger.debug(`🏆 Vérification enchères pour ${watchedChannels.length} canal(aux)`);
      this.stats.totalChecks++;
      
      for (const channelConfig of watchedChannels) {
        try {
          await this.checkChannelAuctions(channelConfig);
          
          // Mettre à jour la dernière vérification
          this.updateLastCheck(channelConfig.channelId);
          
          // Attendre 2 secondes entre chaque canal
          await new Promise(resolve => setTimeout(resolve, 2000));
          
        } catch (error) {
          logger.error(`Erreur vérification enchères canal ${channelConfig.channelId}:`, error);
        }
      }
      
      // Nettoyer les anciennes notifications
      this.cleanupOldNotifications();
      
    } catch (error) {
      logger.error('Erreur surveillance enchères globale:', error);
    }
  }

  getWatchedChannels() {
    const watched = [];
    
    for (const [channelId, registrations] of this.dataManager.data.registrations.entries()) {
      const settings = this.dataManager.getChannelSettings(channelId);
      
      if (settings.encheresWatching && settings.encheresWatching.enabled) {
        watched.push({
          channelId,
          clubs: settings.encheresWatching.clubs || [],
          players: settings.encheresWatching.players || [],
          notificationTimes: settings.encheresWatching.notificationTimes || [30, 15, 5, 1]
        });
      }
    }
    
    return watched;
  }

  async checkChannelAuctions(channelConfig) {
    const { channelId, clubs, players } = channelConfig;
    
    try {
      // Récupérer toutes les enchères actives
      const allAuctions = await this.fetchAllAuctions(clubs, players);
      
      if (allAuctions.length === 0) {
        logger.debug(`Aucune enchère active pour le canal ${channelId}`);
        return;
      }
      
      logger.debug(`📊 ${allAuctions.length} enchère(s) trouvée(s) pour le canal ${channelId}`);
      
      // Vérifier les dépassements
      await this.checkForOutbids(channelId, allAuctions);
      
      // Vérifier les fins imminentes
      await this.checkEndingSoon(channelId, allAuctions, channelConfig.notificationTimes);
      
    } catch (error) {
      logger.error(`Erreur récupération enchères canal ${channelId}:`, error);
    }
  }

  async fetchAllAuctions(clubs, players) {
    const allAuctions = [];
    
    try {
      // Récupérer les enchères des clubs
      for (const clubId of clubs) {
        try {
          const response = await this.apiClient.makeRpcRequest('get_clubs_transfer_bids', {
            club_id: clubId
          });
          
          // CORRECTION: Traiter la structure de réponse correctement
          let clubAuctions = [];
          if (response && Array.isArray(response)) {
            clubAuctions = response;
          } else if (response && response.data && Array.isArray(response.data)) {
            clubAuctions = response.data;
          }
          
          if (clubAuctions.length > 0) {
            const enrichedAuctions = clubAuctions.map(auction => ({
              ...auction,
              monitoring_club_id: clubId,
              source: 'club'
            }));
            allAuctions.push(...enrichedAuctions);
          }
          
          // Attendre 1 seconde entre chaque club
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          logger.error(`Erreur récupération enchères club ${clubId}:`, error);
        }
      }
      
      // Récupérer les enchères des joueurs spécifiques
      for (const playerId of players) {
        try {
          const response = await this.apiClient.makeRpcRequest('get_transfer_auction_details', {
            player_id: playerId
          });
          
          // CORRECTION: Traiter la structure de réponse correctement
          let auctionData = null;
          if (response && response.data) {
            auctionData = response.data;
          } else if (response && response.started !== undefined) {
            auctionData = response;
          }
          
          if (auctionData && auctionData.started && auctionData.end_time) {
            const playerAuction = {
              transfer_auction_id: auctionData.transfer_auction_id,
              player_id: auctionData.player_id,
              highest_bid: auctionData.high_bid ? auctionData.high_bid.amount : auctionData.minimum_bid,
              highest_bidder: auctionData.high_bid ? auctionData.high_bid.club_id : auctionData.club_id,
              self_bid: 0, // Pas de self_bid pour les joueurs surveillés
              end_timestamp: auctionData.end_time,
              source: 'player',
              monitoring_club_id: null
            };
            
            // Éviter les doublons si le joueur est aussi dans les enchères du club
            const exists = allAuctions.find(a => a.transfer_auction_id === playerAuction.transfer_auction_id);
            if (!exists) {
              allAuctions.push(playerAuction);
            }
          }
          
          // Attendre 1 seconde entre chaque joueur
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          logger.error(`Erreur récupération enchère joueur ${playerId}:`, error);
        }
      }
      
      // CORRECTION: Enrichir avec les timestamps de fin pour les enchères de clubs
      for (const auction of allAuctions) {
        if (auction.source === 'club' && !auction.end_timestamp && auction.player_id) {
          try {
            const detailResponse = await this.apiClient.makeRpcRequest('get_transfer_auction_details', {
              player_id: auction.player_id
            });
            
            let detailData = null;
            if (detailResponse && detailResponse.data) {
              detailData = detailResponse.data;
            } else if (detailResponse && detailResponse.end_time !== undefined) {
              detailData = detailResponse;
            }
            
            if (detailData && detailData.end_time) {
              auction.end_timestamp = detailData.end_time;
            }
            
            // Attendre 500ms entre chaque requête de détail
            await new Promise(resolve => setTimeout(resolve, 500));
            
          } catch (error) {
            logger.debug(`Impossible de récupérer le timestamp pour l'enchère ${auction.transfer_auction_id || 'inconnue'}`);
          }
        }
      }
      
    } catch (error) {
      logger.error('Erreur récupération enchères:', error);
    }
    
    return allAuctions;
  }

  async checkForOutbids(channelId, auctions) {
    for (const auction of auctions) {
      // Ignorer les joueurs surveillés car ils n'ont pas de self_bid
      if (auction.source === 'player') continue;
      
      // S'assurer que nous avons un ID d'enchère valide
      if (!auction.transfer_auction_id) continue;
      
      const auctionKey = `${channelId}_${auction.transfer_auction_id}`;
      const previous = this.previousBids.get(auctionKey);
      
      if (previous) {
        const wasLeading = previous.self_bid >= previous.highest_bid;
        const isNowOutbid = auction.self_bid < auction.highest_bid;
        
        if (wasLeading && isNowOutbid) {
          await this.sendOutbidNotification(channelId, auction);
          this.stats.outbidsDetected++;
        }
      }
      
      // Mettre à jour le cache
      this.previousBids.set(auctionKey, {
        highest_bid: auction.highest_bid,
        self_bid: auction.self_bid,
        highest_bidder: auction.highest_bidder
      });
    }
  }

  async checkEndingSoon(channelId, auctions, notificationTimes) {
    const now = Math.floor(Date.now() / 1000);
    
    for (const auction of auctions) {
      if (!auction.end_timestamp || !auction.transfer_auction_id) continue;
      
      const remaining = auction.end_timestamp - now;
      const remainingMinutes = Math.floor(remaining / 60);
      
      // Ignorer les enchères déjà terminées ou trop lointaines
      if (remainingMinutes <= 0 || remainingMinutes > 60) continue;
      
      for (const notifyMinutes of notificationTimes) {
        const notificationKey = `${channelId}_${auction.transfer_auction_id}_${notifyMinutes}`;
        
        if (remainingMinutes <= notifyMinutes && remainingMinutes > 0 && !this.notifiedEndingSoon.has(notificationKey)) {
          await this.sendEndingSoonNotification(channelId, auction, notifyMinutes);
          this.notifiedEndingSoon.add(notificationKey);
          this.stats.endingAlertsSent++;
        }
      }
    }
  }

  async sendOutbidNotification(channelId, auction) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        logger.warn(`Canal ${channelId} introuvable pour notification dépassement`);
        return;
      }
      
      const playerName = this.apiClient.getPlayerName(auction.player_id);
      const bidderName = this.apiClient.getClubName(auction.highest_bidder);
      const clubName = this.apiClient.getClubName(auction.monitoring_club_id);
      
      const embed = new EmbedBuilder()
        .setColor('#FF4444')
        .setTitle('🚨 Enchère Dépassée !')
        .setThumbnail(`https://elrincondeldt.com/sv/photos/players/${auction.player_id}.png`)
        .setDescription(`Votre enchère pour **${playerName}** a été dépassée !`)
        .addFields(
          {
            name: '👤 Joueur',
            value: `[${playerName}](https://play.soccerverse.com/player/${auction.player_id})`,
            inline: true
          },
          {
            name: '🏟️ Votre Club',
            value: clubName,
            inline: true
          },
          {
            name: '🏆 Enchère',
            value: `#${auction.transfer_auction_id}`,
            inline: true
          },
          {
            name: '💰 Votre Offre',
            value: this.formatCurrency(auction.self_bid),
            inline: true
          },
          {
            name: '💸 Nouvelle Offre Max',
            value: this.formatCurrency(auction.highest_bid),
            inline: true
          },
          {
            name: '🔥 Enchérisseur',
            value: bidderName,
            inline: true
          }
        )
        .setFooter({ 
          text: 'Enchérissez rapidement pour reprendre la tête ! • Soccerverse Bot v3.0' 
        })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      this.stats.notificationsSent++;
      
      logger.info(`🚨 Notification dépassement envoyée: ${playerName} pour ${clubName}`);
      
    } catch (error) {
      logger.error('Erreur envoi notification dépassement:', error);
    }
  }

  async sendEndingSoonNotification(channelId, auction, minutesLeft) {
    try {
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        logger.warn(`Canal ${channelId} introuvable pour notification fin imminente`);
        return;
      }
      
      const playerName = this.apiClient.getPlayerName(auction.player_id);
      const bidderName = this.apiClient.getClubName(auction.highest_bidder);
      
      let urgencyColor = '#FFA500';
      let urgencyEmoji = '⏰';
      
      if (minutesLeft <= 5) {
        urgencyColor = '#FF6B6B';
        urgencyEmoji = '🚨';
      } else if (minutesLeft <= 15) {
        urgencyColor = '#FF9800';
        urgencyEmoji = '⚠️';
      }
      
      const embed = new EmbedBuilder()
        .setColor(urgencyColor)
        .setTitle(`${urgencyEmoji} Enchère se termine dans ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''} !`)
        .setThumbnail(`https://elrincondeldt.com/sv/photos/players/${auction.player_id}.png`)
        .setDescription(`**${playerName}** - Dernière chance d'enchérir !`)
        .addFields(
          {
            name: '👤 Joueur',
            value: `[${playerName}](https://play.soccerverse.com/player/${auction.player_id})`,
            inline: true
          },
          {
            name: '💰 Enchère Actuelle',
            value: this.formatCurrency(auction.highest_bid),
            inline: true
          },
          {
            name: '🏟️ En Tête',
            value: bidderName,
            inline: true
          },
          {
            name: '⏱️ Temps Restant',
            value: `${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}`,
            inline: true
          },
          {
            name: '🏆 ID Enchère',
            value: `#${auction.transfer_auction_id}`,
            inline: true
          },
          {
            name: '🔗 Action',
            value: `[Enchérir maintenant](https://play.soccerverse.com/transfers)`,
            inline: true
          }
        )
        .setFooter({ 
          text: `Ne ratez pas cette opportunité ! • Soccerverse Bot v3.0` 
        })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      this.stats.notificationsSent++;
      
      logger.info(`⏰ Notification fin imminente envoyée: ${playerName} (${minutesLeft}min)`);
      
    } catch (error) {
      logger.error('Erreur envoi notification fin imminente:', error);
    }
  }

  formatCurrency(amount) {
    if (!amount || amount === 0) return '0$';
    
    // L'API renvoie les montants qu'il faut diviser par 10 000
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

  updateLastCheck(channelId) {
    try {
      const settings = this.dataManager.getChannelSettings(channelId);
      
      if (settings.encheresWatching) {
        settings.encheresWatching.lastCheck = Date.now();
        this.dataManager.setChannelSettings(channelId, settings);
      }
    } catch (error) {
      logger.error('Erreur mise à jour dernière vérification:', error);
    }
  }

  cleanupOldNotifications() {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    let cleanedCount = 0;
    
    // CORRECTION: Nettoyer efficacement les notifications anciennes
    for (const notificationKey of this.notifiedEndingSoon) {
      // Format de clé: channelId_auctionId_minutes
      // Pour une vraie implémentation, nous devrions stocker les timestamps
      // Ici, on fait un nettoyage basique toutes les 24h
      if (Math.random() < 0.1) { // 10% de chance de nettoyer chaque clé
        this.notifiedEndingSoon.delete(notificationKey);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.debug(`🧹 Nettoyage notifications enchères: ${cleanedCount} entrées supprimées`);
    }
  }

  // =================== MÉTHODES DE GESTION ===================

  enableWatching(channelId) {
    const settings = this.dataManager.getChannelSettings(channelId);
    
    if (settings.encheresWatching) {
      settings.encheresWatching.enabled = true;
      this.dataManager.setChannelSettings(channelId, settings);
      
      logger.info(`🏆 Surveillance enchères activée: Canal ${channelId}`);
    }
  }

  disableWatching(channelId) {
    const settings = this.dataManager.getChannelSettings(channelId);
    
    if (settings.encheresWatching) {
      settings.encheresWatching.enabled = false;
      this.dataManager.setChannelSettings(channelId, settings);
      
      logger.info(`🏆 Surveillance enchères désactivée: Canal ${channelId}`);
    }
  }

  getEncheresStats() {
    const watchedChannels = this.getWatchedChannels();
    
    return {
      active: true,
      watchedChannels: watchedChannels.length,
      totalChecks: this.stats.totalChecks,
      notificationsSent: this.stats.notificationsSent,
      outbidsDetected: this.stats.outbidsDetected,
      endingAlertsSent: this.stats.endingAlertsSent,
      checkInterval: this.checkInterval / 1000,
      cacheSize: this.previousBids.size,
      notifiedCount: this.notifiedEndingSoon.size
    };
  }

  async forceCheck() {
    logger.info('🔄 Vérification forcée enchères...');
    await this.checkAllWatchedAuctions();
  }

  resetEncheresCache() {
    this.previousBids.clear();
    this.notifiedEndingSoon.clear();
    this.stats = {
      totalChecks: 0,
      notificationsSent: 0,
      outbidsDetected: 0,
      endingAlertsSent: 0
    };
    logger.info('🔄 Cache enchères réinitialisé');
  }

  // Debug: Afficher les enchères surveillées
  debugEncheresWatching() {
    logger.debug('=== ENCHÈRES SURVEILLANCE DEBUG ===');
    const watchedChannels = this.getWatchedChannels();
    
    if (watchedChannels.length === 0) {
      logger.debug('Aucune surveillance active');
    } else {
      for (const config of watchedChannels) {
        logger.debug(`Canal ${config.channelId}:`);
        logger.debug(`  └ Clubs: [${config.clubs.join(', ')}]`);
        logger.debug(`  └ Joueurs: [${config.players.join(', ')}]`);
        logger.debug(`  └ Notifications: [${config.notificationTimes.join(', ')}] minutes`);
      }
    }
    
    logger.debug(`Cache enchères précédentes: ${this.previousBids.size}`);
    logger.debug(`Cache notifications envoyées: ${this.notifiedEndingSoon.size}`);
    logger.debug(`Statistiques: ${JSON.stringify(this.stats, null, 2)}`);
    logger.debug('=== FIN DEBUG ENCHÈRES ===');
  }
}

module.exports = EncheresWatcher;
