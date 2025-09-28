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
      endingAlertseSent: 0
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
          
          if (response && response.data && Array.isArray(response.data)) {
            const clubAuctions = response.data.map(auction => ({
              ...auction,
              monitoring_club_id: clubId,
              source: 'club'
            }));
            allAuctions.push(...clubAuctions);
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
          
          if (response && response.data && response.data.started && response.data.end_time) {
            const playerAuction = {
              transfer_auction_id: response.data.transfer_auction_id,
              player_id: response.data.player_id,
              highest_bid: response.data.high_bid ? response.data.high_bid.amount : response.data.minimum_bid,
              highest_bidder: response.data.high_bid ? response.data.high_bid.club_id : response.data.club_id,
              self_bid: 0,
              end_timestamp: response.data.end_time,
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
      
      // Enrichir avec les timestamps de fin pour les enchères de clubs
      for (const auction of allAuctions) {
        if (auction.source === 'club' && !auction.end_timestamp) {
          try {
            const detailResponse = await this.apiClient.makeRpcRequest('get_transfer_auction_details', {
              player_id: auction.player_id
            });
            
            if (detailResponse && detailResponse.data && detailResponse.data.end_time) {
              auction.end_timestamp = detailResponse.data.end_time;
            }
          } catch (error) {
            logger.debug(`Impossible de récupérer le timestamp pour l'enchère ${auction.transfer_auction_id}`);
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
      if (!auction.end_timestamp) continue;
      
      const remaining = auction.end_timestamp - now;
      const remainingMinutes = Math.floor(remaining / 60);
      
      for (const notifyMinutes of notificationTimes) {
        const notificationKey = `${channelId}_${auction.transfer_auction_id}_${notifyMinutes}`;
        
        if (remainingMinutes <= notifyMinutes && remainingMinutes > 0 && !this.notifiedEndingSoon.has(notificationKey)) {
          await this.sendEndingSoonNotification(channelId, auction, notifyMinutes);
          this.notifiedEndingSoon.add(notificationKey);
          this.stats.endingAlertseSent++;
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
            name: '🔥
