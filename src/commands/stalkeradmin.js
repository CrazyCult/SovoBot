const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'stalkeradmin',
  description: 'Administration du service Polygon Stalker (super admin)',
  usage: '!stalkeradmin [status|test|reset|cleanup|debug]',
  
  async execute(message, args, { dataManager, polygonStalkerService }) {
    // Vérifier les permissions d'administrateur
    if (!message.member || !message.member.permissions.has('ADMINISTRATOR')) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Permission refusée')
        .setDescription('Cette commande est réservée aux administrateurs du serveur.')
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    if (!polygonStalkerService) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Service indisponible')
        .setDescription('Le service Polygon Stalker n\'est pas initialisé.')
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const action = args[0]?.toLowerCase();

    switch (action) {
      case 'status':
        await this.showStalkerStatus(message, { dataManager, polygonStalkerService });
        break;
        
      case 'test':
        await this.testStalkerService(message, { polygonStalkerService });
        break;
        
      case 'reset':
        await this.resetStalkerService(message, { polygonStalkerService });
        break;
        
      case 'cleanup':
        await this.cleanupStalkerService(message, { polygonStalkerService });
        break;
        
      case 'debug':
        await this.debugStalkerService(message, { polygonStalkerService });
        break;
        
      default:
        await this.showHelp(message);
    }
  },

  async showStalkerStatus(message, { dataManager, polygonStalkerService }) {
    const stats = polygonStalkerService.getStalkerStats();
    const watchedUsers = polygonStalkerService.getWatchedUsers();

    const embed = new EmbedBuilder()
      .setColor('#9C27B0')
      .setTitle('📊 Statut Service Polygon Stalker')
      .setDescription('Surveillance automatique des transactions Polygon')
      .addFields(
        {
          name: '👥 Statistiques générales',
          value: 
            `**Utilisateurs surveillés:** ${stats.watchedUsersCount}\n` +
            `**Canaux uniques:** ${stats.uniqueChannels}\n` +
            `**Wallets uniques:** ${stats.uniqueWallets}\n` +
            `**Cache actuel:** ${stats.cacheSize} transactions`,
          inline: true
        },
        {
          name: '⚙️ Configuration',
          value: 
            `**Fréquence:** ${stats.checkInterval}s\n` +
            `**API:** PolygonScan\n` +
            `**Proxy:** AllOrigins\n` +
            `**Contrat:** Xaya NFT`,
          inline: true
        },
        {
          name: '🌐 Réseau',
          value: 
            `**Blockchain:** Polygon\n` +
            `**Token natif:** MATIC\n` +
            `**Explorateur:** PolygonScan\n` +
            `**Statut:** 🟢 Actif`,
          inline: true
        }
      );

    if (watchedUsers.length > 0) {
      // Grouper par canal pour affichage
      const channelGroups = new Map();
      
      for (const user of watchedUsers) {
        if (!channelGroups.has(user.channelId)) {
          channelGroups.set(user.channelId, []);
        }
        channelGroups.get(user.channelId).push(user);
      }
      
      let channelsInfo = '';
      let displayCount = 0;
      
      for (const [channelId, users] of channelGroups.entries()) {
        if (displayCount >= 5) break; // Limiter à 5 canaux
        
        const channel = message.client.channels.cache.get(channelId);
        const channelName = channel ? `#${channel.name}` : `Canal ${channelId}`;
        
        channelsInfo += `**${channelName}:** ${users.length} utilisateur(s)\n`;
        
        // Afficher max 2 utilisateurs par canal
        for (const user of users.slice(0, 2)) {
          channelsInfo += `  └ ${user.username} (${user.namespace})\n`;
        }
        if (users.length > 2) {
          channelsInfo += `  └ ... et ${users.length - 2} autre(s)\n`;
        }
        
        displayCount++;
      }
      
      if (channelGroups.size > 5) {
        channelsInfo += `... et ${channelGroups.size - 5} autre(s) canaux`;
      }
      
      embed.addFields({
        name: '📋 Répartition par canal',
        value: channelsInfo || 'Aucune surveillance',
        inline: false
      });
    }

    embed.setFooter({ 
      text: 'Service fonctionnant 24/7 en arrière-plan • Soccerverse Bot v3.0' 
    })
    .setTimestamp();

    await message.reply({ embeds: [embed] });
  },

  async testStalkerService(message, { polygonStalkerService }) {
    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('🔄 Test du service Stalker...')
      .setDescription('Vérification forcée de tous les utilisateurs surveillés...')
      .addFields({
        name: '⏳ Opérations',
        value: '• Test résolution blockchain\n• Vérification API PolygonScan\n• Test notifications'
      })
      .setFooter({ text: 'Cette opération peut prendre 1-2 minutes' });

    const statusMessage = await message.reply({ embeds: [embed] });

    try {
      const startTime = Date.now();
      
      // Forcer une vérification
      await polygonStalkerService.forceCheck();
      
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(1);
      
      const stats = polygonStalkerService.getStalkerStats();
      
      const successEmbed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Test terminé avec succès')
        .setDescription(`Vérification forcée effectuée en ${duration}s`)
        .addFields(
          {
            name: '📊 Résultats',
            value: 
              `**Utilisateurs vérifiés:** ${stats.watchedUsersCount}\n` +
              `**Durée totale:** ${duration}s\n` +
              `**Statut API:** ✅ Fonctionnel`,
            inline: true
          },
          {
            name: '🔧 Cache',
            value: 
              `**Transactions en cache:** ${stats.cacheSize}\n` +
              `**Canaux actifs:** ${stats.uniqueChannels}\n` +
              `**Wallets surveillés:** ${stats.uniqueWallets}`,
            inline: true
          }
        )
        .setTimestamp();

      await statusMessage.edit({ embeds: [successEmbed] });
      
    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur lors du test')
        .setDescription('Une erreur est survenue pendant le test du service.')
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        });

      await statusMessage.edit({ embeds: [errorEmbed] });
    }
  },

  async resetStalkerService(message, { polygonStalkerService }) {
    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('⚠️ Réinitialisation du cache Stalker')
      .setDescription('Voulez-vous vraiment réinitialiser le cache des transactions ?')
      .addFields({
        name: '📝 Conséquences',
        value: 
          'Cela va :\n' +
          '• Vider le cache des dernières transactions\n' +
          '• Permettre de recevoir à nouveau les anciennes notifications\n' +
          '• **NE PAS** supprimer les surveillances actives',
        inline: false
      })
      .setFooter({ text: 'Réagissez avec ✅ pour confirmer ou ❌ pour annuler' });

    const confirmMessage = await message.reply({ embeds: [embed] });
    await confirmMessage.react('✅');
    await confirmMessage.react('❌');

    const filter = (reaction, user) => {
      return ['✅', '❌'].includes(reaction.emoji.name) && user.id === message.author.id;
    };

    try {
      const collected = await confirmMessage.awaitReactions({ 
        filter, 
        max: 1, 
        time: 30000, 
        errors: ['time'] 
      });

      const reaction = collected.first();

      if (reaction.emoji.name === '✅') {
        const statsBefore = polygonStalkerService.getStalkerStats();
        
        polygonStalkerService.resetStalkerCache();
        
        const successEmbed = new EmbedBuilder()
          .setColor('#4CAF50')
          .setTitle('✅ Cache réinitialisé')
          .setDescription('Le cache des transactions Stalker a été vidé avec succès.')
          .addFields({
            name: '🔄 Opération effectuée',
            value: 
              `**Transactions en cache (avant):** ${statsBefore.cacheSize}\n` +
              `**Transactions en cache (après):** 0\n` +
              `**Surveillances actives:** ${statsBefore.watchedUsersCount} (inchangé)`
          })
          .setTimestamp();

        await confirmMessage.edit({ embeds: [successEmbed] });
      } else {
        const cancelEmbed = new EmbedBuilder()
          .setColor('#95A5A6')
          .setTitle('❌ Opération annulée')
          .setDescription('La réinitialisation du cache a été annulée.');

        await confirmMessage.edit({ embeds: [cancelEmbed] });
      }
    } catch (error) {
      const timeoutEmbed = new EmbedBuilder()
        .setColor('#95A5A6')
        .setTitle('⏰ Temps écoulé')
        .setDescription('Opération annulée par timeout.');

      await confirmMessage.edit({ embeds: [timeoutEmbed] });
    }
  },

  async cleanupStalkerService(message, { polygonStalkerService }) {
    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('🧹 Nettoyage des surveillances orphelines...')
      .setDescription('Recherche des canaux Discord supprimés...')
      .setFooter({ text: 'Cette opération peut prendre quelques secondes' });

    const statusMessage = await message.reply({ embeds: [embed] });

    try {
      const cleanupCount = await polygonStalkerService.cleanupOrphanedWatches();
      
      const resultEmbed = new EmbedBuilder()
        .setColor(cleanupCount > 0 ? '#4CAF50' : '#2196F3')
        .setTitle('🧹 Nettoyage terminé')
        .setDescription(
          cleanupCount > 0 
            ? `${cleanupCount} surveillance(s) orpheline(s) supprimée(s).`
            : 'Aucune surveillance orpheline trouvée.'
        )
        .addFields({
          name: '📊 Résultat',
          value: 
            `**Surveillances nettoyées:** ${cleanupCount}\n` +
            `**Raison:** Canal Discord supprimé\n` +
            `**Statut:** ${cleanupCount > 0 ? 'Nettoyage effectué' : 'Aucun nettoyage nécessaire'}`
        })
        .setTimestamp();

      await statusMessage.edit({ embeds: [resultEmbed] });
      
    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur lors du nettoyage')
        .setDescription('Une erreur est survenue pendant le nettoyage.')
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        });

      await statusMessage.edit({ embeds: [errorEmbed] });
    }
  },

  async debugStalkerService(message, { polygonStalkerService }) {
    // Afficher les informations de debug dans la console
    polygonStalkerService.debugStalkerWatching();
    
    const stats = polygonStalkerService.getStalkerStats();
    const watchedUsers = polygonStalkerService.getWatchedUsers();
    
    const embed = new EmbedBuilder()
      .setColor('#9C27B0')
      .setTitle('🔧 Debug Polygon Stalker')
      .setDescription('Informations techniques détaillées')
      .addFields(
        {
          name: '🏗️ Architecture',
          value: 
            `**Classe:** PolygonStalkerService\n` +
            `**Intervalle:** ${stats.checkInterval}s\n` +
            `**Cache Map:** ${stats.cacheSize} entrées\n` +
            `**Proxy CORS:** AllOrigins`,
          inline: true
        },
        {
          name: '📊 Métriques temps réel',
          value: 
            `**Users actifs:** ${stats.watchedUsersCount}\n` +
            `**Canaux uniques:** ${stats.uniqueChannels}\n` +
            `**Wallets surveillés:** ${stats.uniqueWallets}\n` +
            `**Dernière vérif:** En cours...`,
          inline: true
        }
      );

    if (watchedUsers.length > 0) {
      let debugInfo = '';
      
      for (const user of watchedUsers.slice(0, 5)) {
        const addedDate = new Date(user.addedAt).toLocaleDateString('fr-FR');
        debugInfo += `**${user.username}** (${user.namespace})\n`;
        debugInfo += `  └ Wallet: ${user.wallet.substring(0, 15)}...\n`;
        debugInfo += `  └ Canal: ${user.channelId} | Ajouté: ${addedDate}\n\n`;
      }
      
      if (watchedUsers.length > 5) {
        debugInfo += `... et ${watchedUsers.length - 5} autre(s)`;
      }
      
      embed.addFields({
        name: '🔍 Surveillances actives',
        value: debugInfo,
        inline: false
      });
    }

    embed.addFields({
      name: '🛠️ Actions de debug',
      value: 
        '• Logs détaillés envoyés dans la console\n' +
        '• Vérification intégrité des données\n' +
        '• État des caches en mémoire\n' +
        '• Mapping canal ↔ surveillances',
      inline: false
    });

    embed.setFooter({ 
      text: 'Debug info • Consultez la console pour plus de détails • Soccerverse Bot v3.0' 
    })
    .setTimestamp();

    await message.reply({ embeds: [embed] });
  },

  async showHelp(message) {
    const embed = new EmbedBuilder()
      .setColor('#9C27B0')
      .setTitle('🔧 Administration Polygon Stalker')
      .setDescription('Commandes d\'administration pour le service de surveillance')
      .addFields(
        {
          name: '📊 Commandes disponibles',
          value: 
            '**`!stalkeradmin status`** - Statut détaillé du service\n' +
            '**`!stalkeradmin test`** - Lancer un test complet\n' +
            '**`!stalkeradmin reset`** - Réinitialiser le cache\n' +
            '**`!stalkeradmin cleanup`** - Nettoyer les surveillances orphelines\n' +
            '**`!stalkeradmin debug`** - Informations techniques détaillées',
          inline: false
        },
        {
          name: '🔧 Utilisation recommandée',
          value: 
            '• **Status** : Vérification quotidienne du bon fonctionnement\n' +
            '• **Test** : En cas de problème de notifications\n' +
            '• **Reset** : Si des notifications en double apparaissent\n' +
            '• **Cleanup** : Maintenance hebdomadaire\n' +
            '• **Debug** : Diagnostic en cas de dysfonctionnement',
          inline: false
        },
        {
          name: '⚠️ Informations importantes',
          value: 
            '• Ces commandes n\'affectent PAS les surveillances actives\n' +
            '• Le service fonctionne automatiquement en arrière-plan\n' +
            '• Les données sont sauvegardées automatiquement\n' +
            '• Accessible uniquement aux administrateurs Discord',
          inline: false
        },
        {
          name: '📡 Architecture technique',
          value: 
            '• **API** : PolygonScan pour les transactions\n' +
            '• **Blockchain** : Contrat Xaya sur Polygon\n' +
            '• **Résolution** : Username NFT → Adresse wallet\n' +
            '• **Fréquence** : Vérification toutes les 30 secondes',
          inline: false
        }
      )
      .setFooter({ text: 'Commande réservée aux super administrateurs • Soccerverse Bot v3.0' });

    await message.reply({ embeds: [embed] });
  }
};
