const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'orderbook',
  description: 'Afficher et surveiller les ordres d\'achat/vente d\'un club',
  usage: '!orderbook [club_id] [min_price] [max_price]',
  
  async execute(message, args, { apiClient, dataManager }) {
    const channelId = message.channel.id;
    let clubId;
    let minPrice = null;
    let maxPrice = null;

    // Si aucun argument, utiliser les clubs enregistrés
    if (args.length === 0) {
      const registeredClubs = dataManager.getChannelClubs(channelId);
      
      if (registeredClubs.length === 0) {
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('📋 Aucun club inscrit')
          .setDescription('Ce salon n\'a aucun club inscrit aux notifications.')
          .addFields({
            name: '💡 Usage',
            value: '• `!orderbook` - Orderbook du club inscrit\n• `!orderbook <club_id>` - Orderbook d\'un club spécifique\n• `!orderbook <club_id> <min> <max>` - Avec surveillance des prix'
          })
          .addFields({
            name: '📝 Pour s\'inscrire',
            value: '`!inscription <club_id>`'
          })
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await message.reply({ embeds: [embed] });
        return;
      }

      clubId = parseInt(registeredClubs[0]);
      
      if (registeredClubs.length > 1) {
        const clubNames = [];
        for (const id of registeredClubs.slice(0, 3)) {
          try {
            const clubData = await apiClient.getClubDetails(id);
            clubNames.push(clubData.display_name);
          } catch (error) {
            clubNames.push(`Club #${id}`);
          }
        }
        
        const embed = new EmbedBuilder()
          .setColor('#2196F3')
          .setTitle('📋 Plusieurs clubs inscrits')
          .setDescription(`Affichage de l'orderbook de **${apiClient.getClubName(clubId)}** (premier club inscrit).`)
          .addFields({
            name: '🏟️ Clubs inscrits dans ce salon',
            value: clubNames.join(', ') + (registeredClubs.length > 3 ? `... et ${registeredClubs.length - 3} autre(s)` : '')
          })
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await message.reply({ embeds: [embed] });
      }
    } else {
      // Arguments fournis
      clubId = parseInt(args[0]);
      if (args[1]) minPrice = parseFloat(args[1]);
      if (args[2]) maxPrice = parseFloat(args[2]);
    }
    
    // Vérifier que l'ID est un nombre
    if (isNaN(clubId)) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ ID invalide')
        .setDescription('L\'ID du club doit être un nombre.')
        .addFields({
          name: 'Exemples valides',
          value: '`!orderbook 2180`\n`!orderbook 2180 1000 5000`'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    // Vérifier les prix min/max
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Paramètres invalides')
        .setDescription('Le prix minimum ne peut pas être supérieur au prix maximum.')
        .addFields({
          name: 'Exemple correct',
          value: '`!orderbook 2180 1000 5000`'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    try {
      // Récupérer les infos du club
      let clubData;
      try {
        clubData = await apiClient.getClubDetails(clubId);
      } catch (error) {
        const embed = new EmbedBuilder()
          .setColor('#FF6B6B')
          .setTitle('❌ Club introuvable')
          .setDescription(`Le club avec l'ID **${clubId}** n'existe pas.`)
          .addFields({
            name: '💡 Suggestion',
            value: 'Vérifiez l\'ID du club et réessayez.'
          });
        
        await message.reply({ embeds: [embed] });
        return;
      }
      
      // Récupérer les ordres du club
      const orderbook = await this.fetchClubOrderbook(clubId);
      
      if (!orderbook || (orderbook.buyOrders.length === 0 && orderbook.sellOrders.length === 0)) {
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('📊 Aucun ordre')
          .setDescription(`Aucun ordre d'achat ou de vente trouvé pour **${clubData.display_name}**.`)
          .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`)
          .setFooter({ text: `Club ID: ${clubId} • Soccerverse Bot v3.0` });
        
        await message.reply({ embeds: [embed] });
        return;
      }

      // Filtrer les ordres selon les critères de prix
      let filteredBuyOrders = orderbook.buyOrders;
      let filteredSellOrders = orderbook.sellOrders;
      
      if (minPrice !== null || maxPrice !== null) {
        if (minPrice !== null) {
          filteredBuyOrders = filteredBuyOrders.filter(order => order.price >= minPrice * 10000);
          filteredSellOrders = filteredSellOrders.filter(order => order.price >= minPrice * 10000);
        }
        if (maxPrice !== null) {
          filteredBuyOrders = filteredBuyOrders.filter(order => order.price <= maxPrice * 10000);
          filteredSellOrders = filteredSellOrders.filter(order => order.price <= maxPrice * 10000);
        }
      }

      // Vérifier si une surveillance est déjà active pour ce club
      const settings = dataManager.getChannelSettings(channelId);
      const orderbookWatching = settings.orderbookWatching || {};
      const isWatched = orderbookWatching[clubId] && orderbookWatching[clubId].enabled;

      // Créer l'embed principal
      const embed = new EmbedBuilder()
        .setColor('#9B59B6')
        .setTitle(`📊 Orderbook - ${clubData.display_name}`)
        .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`)
        .setDescription(`**Manager:** ${clubData.manager_name}\n**Pays:** ${apiClient.formatCountryName(clubData.country_id)}`);

      // Ajouter les critères de filtrage si définis
      if (minPrice !== null || maxPrice !== null) {
        let filterText = 'Filtres actifs: ';
        if (minPrice !== null) filterText += `Min: ${minPrice.toLocaleString()}$ `;
        if (maxPrice !== null) filterText += `Max: ${maxPrice.toLocaleString()}$`;
        
        embed.addFields({
          name: '🔍 Filtrage',
          value: filterText,
          inline: false
        });
      }

      // Afficher l'état de surveillance si active
      if (isWatched) {
        const watchConfig = orderbookWatching[clubId];
        let watchText = '🔔 **Surveillance active**';
        if (watchConfig.minPrice || watchConfig.maxPrice) {
          watchText += ' - Critères: ';
          if (watchConfig.minPrice) watchText += `Min: ${(watchConfig.minPrice / 10000).toLocaleString()}$ `;
          if (watchConfig.maxPrice) watchText += `Max: ${(watchConfig.maxPrice / 10000).toLocaleString()}$`;
        }
        
        embed.addFields({
          name: '👁️ Surveillance',
          value: watchText,
          inline: false
        });
      }

      // Ajouter les ordres d'achat
      if (filteredBuyOrders.length > 0) {
        const buyOrdersText = filteredBuyOrders
          .sort((a, b) => b.price - a.price) // Trier par prix décroissant
          .slice(0, 10) // Limiter à 10 ordres
          .map(order => {
            const price = (order.price / 10000).toLocaleString('fr-FR');
            return `**${order.username || 'Utilisateur supprimé'}**\n└ ${price}$ • ${order.shares} parts • #${order.orderId}`;
          })
          .join('\n\n');

        embed.addFields({
          name: `📈 Ordres d'Achat (${filteredBuyOrders.length})`,
          value: buyOrdersText || 'Aucun ordre d\'achat',
          inline: true
        });
      } else {
        embed.addFields({
          name: '📈 Ordres d\'Achat (0)',
          value: 'Aucun ordre d\'achat',
          inline: true
        });
      }

      // Ajouter les ordres de vente
      if (filteredSellOrders.length > 0) {
        const sellOrdersText = filteredSellOrders
          .sort((a, b) => a.price - b.price) // Trier par prix croissant
          .slice(0, 10) // Limiter à 10 ordres
          .map(order => {
            const price = (order.price / 10000).toLocaleString('fr-FR');
            return `**${order.username || 'Utilisateur supprimé'}**\n└ ${price}$ • ${order.shares} parts • #${order.orderId}`;
          })
          .join('\n\n');

        embed.addFields({
          name: `📉 Ordres de Vente (${filteredSellOrders.length})`,
          value: sellOrdersText || 'Aucun ordre de vente',
          inline: true
        });
      } else {
        embed.addFields({
          name: '📉 Ordres de Vente (0)',
          value: 'Aucun ordre de vente',
          inline: true
        });
      }

      // Statistiques générales
      const totalBuyOrders = orderbook.buyOrders.length;
      const totalSellOrders = orderbook.sellOrders.length;
      const avgBuyPrice = totalBuyOrders > 0 ? 
        (orderbook.buyOrders.reduce((sum, order) => sum + order.price, 0) / totalBuyOrders / 10000).toFixed(2) : 0;
      const avgSellPrice = totalSellOrders > 0 ? 
        (orderbook.sellOrders.reduce((sum, order) => sum + order.price, 0) / totalSellOrders / 10000).toFixed(2) : 0;

      embed.addFields({
        name: '📊 Statistiques',
        value: `**Total ordres:** ${totalBuyOrders + totalSellOrders}\n` +
               `**Prix moyen achat:** ${avgBuyPrice}$\n` +
               `**Prix moyen vente:** ${avgSellPrice}$`,
        inline: false
      });

      embed.setFooter({ text: `Club ID: ${clubId} • Actualisé le ${new Date().toLocaleString('fr-FR')}` })
           .setTimestamp();

      // Ajouter des boutons d'action
      const actionRow = new ActionRowBuilder();
      
      // NOUVEAU COMPORTEMENT: Activer surveillance SEULEMENT si des critères sont fournis
      if (minPrice !== null || maxPrice !== null) {
        const isRegistered = dataManager.isTeamRegistered(channelId, clubId);
        if (isRegistered) {
          // Enregistrer les critères de surveillance dans les paramètres du canal
          const currentSettings = dataManager.getChannelSettings(channelId);
          const orderbookWatching = currentSettings.orderbookWatching || {};
          
          orderbookWatching[clubId] = {
            minPrice: minPrice ? minPrice * 10000 : undefined,
            maxPrice: maxPrice ? maxPrice * 10000 : undefined,
            enabled: true,
            startedAt: Date.now()
          };
          
          dataManager.setChannelSettings(channelId, {
            orderbookWatching: orderbookWatching
          });
          
          actionRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`orderbook_stop_${clubId}`)
              .setLabel('Arrêter la surveillance')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('🔕')
          );
        }
      } else {
        // Affichage simple sans critères - proposer de surveiller
        if (isWatched) {
          // Surveillance déjà active, proposer de l'arrêter
          actionRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`orderbook_stop_${clubId}`)
              .setLabel('Arrêter la surveillance')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('🔕')
          );
        } else {
          // Pas de surveillance, proposer d'en créer une
          actionRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`orderbook_watch_${clubId}`)
              .setLabel('Surveiller ce club')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('👁️')
          );
        }
      }

      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`orderbook_refresh_${clubId}`)
          .setLabel('Actualiser')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔄')
      );

      await message.reply({ 
        embeds: [embed],
        components: [actionRow]
      });

    } catch (error) {
      console.error('❌ Erreur dans la commande orderbook:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription('Une erreur est survenue lors de la récupération de l\'orderbook.')
        .addFields({
          name: '💡 Suggestions',
          value: '• Vérifiez que l\'ID du club est correct\n• L\'API orderbook peut être temporairement indisponible\n• Réessayez dans quelques instants'
        })
        .addFields({
          name: '🔧 Détails techniques',
          value: `\`\`\`${error.message}\`\`\``
        })
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [errorEmbed] });
    }
  },

  // Méthode pour récupérer l'orderbook d'un club spécifique
  async fetchClubOrderbook(clubId) {
    try {
      const axios = require('axios');
      
      // Liste des proxies CORS à essayer
      const proxies = [
        'https://api.allorigins.win/raw?url=',
        'https://cors-anywhere.herokuapp.com/',
        'https://api.codetabs.com/v1/proxy?quest=',
        'https://thingproxy.freeboard.io/fetch/',
        'https://cors.bridged.cc/'
      ];
      
      const targetUrl = 'https://orderbook.soccerverse.io/clubs';
      
      for (let proxy of proxies) {
        try {
          const response = await axios.get(proxy + encodeURIComponent(targetUrl), {
            timeout: 10000,
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'SoccerverseBot/3.0'
            }
          });
          
          if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}`);
          }
          
          const data = response.data;
          
          if (data && data.data && data.data[clubId]) {
            const orders = data.data[clubId];
            
            // Séparer les ordres d'achat (0) et de vente (1)
            const buyOrders = orders.filter(order => order[2] === 0).map(order => ({
              orderId: order[0],
              username: order[1],
              isAsk: order[2],
              price: order[3],
              shares: order[4]
            }));
            
            const sellOrders = orders.filter(order => order[2] === 1).map(order => ({
              orderId: order[0],
              username: order[1],
              isAsk: order[2],
              price: order[3],
              shares: order[4]
            }));
            
            return { buyOrders, sellOrders };
          }
          
        } catch (error) {
          console.log(`Proxy failed:`, error.message);
          continue;
        }
      }
      
      throw new Error('Tous les proxies CORS ont échoué');
      
    } catch (error) {
      console.error('Erreur fetchClubOrderbook:', error);
      throw new Error(`Impossible de récupérer l'orderbook: ${error.message}`);
    }
  }
};
