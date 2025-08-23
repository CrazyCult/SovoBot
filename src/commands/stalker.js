const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const { ethers } = require('ethers');

module.exports = {
  name: 'stalker',
  description: 'Surveiller les transactions Polygon d\'un utilisateur Soccerverse',
  usage: '!stalker <username> [add|remove|list|status]',
  
  async execute(message, args, { apiClient, dataManager }) {
    // Vérifier les permissions d'administrateur pour cette commande sensible
    if (!message.member || !message.member.permissions.has('ADMINISTRATOR')) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Permission refusée')
        .setDescription('Cette commande est réservée aux administrateurs du serveur.')
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const action = args[1]?.toLowerCase() || 'add';
    const channelId = message.channel.id;

    switch (action) {
      case 'add':
        if (!args[0]) {
          await this.showHelp(message);
          return;
        }
        await this.addUserToWatch(message, args[0], channelId, { dataManager });
        break;
        
      case 'remove':
        if (!args[0]) {
          await this.showWatchedUsers(message, channelId, { dataManager });
          return;
        }
        await this.removeUserFromWatch(message, args[0], channelId, { dataManager });
        break;
        
      case 'list':
        await this.showWatchedUsers(message, channelId, { dataManager });
        break;
        
      case 'status':
        await this.showStalkerStatus(message, channelId, { dataManager });
        break;
        
      default:
        if (args[0]) {
          await this.addUserToWatch(message, args[0], channelId, { dataManager });
        } else {
          await this.showHelp(message);
        }
    }
  },

  async addUserToWatch(message, username, channelId, { dataManager }) {
    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('🔍 Résolution blockchain...')
      .setDescription(`Recherche de l'adresse wallet pour **${username}**...`)
      .addFields({
        name: '⏳ Progression',
        value: 'Connexion au contrat Xaya sur Polygon...'
      })
      .setFooter({ text: 'Cette opération peut prendre quelques secondes' });

    const statusMessage = await message.reply({ embeds: [embed] });

    try {
      // Résoudre l'utilisateur vers son wallet
      const walletData = await this.resolveUsernameToWallet(username);
      
      // Récupérer les paramètres de surveillance du canal
      const settings = dataManager.getChannelSettings(channelId);
      const stalkerWatching = settings.stalkerWatching || {};
      
      // Vérifier si déjà surveillé
      if (stalkerWatching[username]) {
        const alreadyEmbed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('⚠️ Utilisateur déjà surveillé')
          .setDescription(`**${username}** est déjà dans la liste de surveillance.`)
          .addFields({
            name: '👤 Informations actuelles',
            value: `**Wallet:** ${stalkerWatching[username].wallet}\n**Namespace:** ${stalkerWatching[username].namespace}\n**Depuis:** ${new Date(stalkerWatching[username].addedAt).toLocaleDateString('fr-FR')}`
          });
        
        await statusMessage.edit({ embeds: [alreadyEmbed] });
        return;
      }
      
      // Ajouter à la surveillance
      stalkerWatching[username] = {
        wallet: walletData.wallet.toLowerCase(),
        tokenId: walletData.tokenId,
        namespace: walletData.namespace,
        addedAt: Date.now(),
        lastTransactionHash: null
      };
      
      dataManager.setChannelSettings(channelId, {
        stalkerWatching: stalkerWatching
      });
      
      await dataManager.save();
      
      const successEmbed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Surveillance activée !')
        .setDescription(`**${username}** est maintenant surveillé dans ce salon.`)
        .addFields(
          {
            name: '👤 Utilisateur',
            value: username,
            inline: true
          },
          {
            name: '💼 Wallet',
            value: `${walletData.wallet.substring(0, 20)}...`,
            inline: true
          },
          {
            name: '🏷️ Namespace',
            value: walletData.namespace,
            inline: true
          },
          {
            name: '🔢 Token ID',
            value: walletData.tokenId,
            inline: true
          },
          {
            name: '📊 Réseau',
            value: 'Polygon (MATIC)',
            inline: true
          },
          {
            name: '⚡ Fréquence',
            value: 'Vérification toutes les 30s',
            inline: true
          }
        )
        .setFooter({ 
          text: 'Les nouvelles transactions seront notifiées automatiquement • Soccerverse Bot v3.0' 
        })
        .setTimestamp();

      await statusMessage.edit({ embeds: [successEmbed] });
      
    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur de résolution')
        .setDescription(`Impossible de trouver l'utilisateur **${username}** sur la blockchain.`)
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        })
        .addFields({
          name: '💡 Solutions',
          value: '• Vérifiez l\'orthographe du nom d\'utilisateur\n• L\'utilisateur doit avoir un compte NFT sur Polygon\n• Réessayez dans quelques instants'
        });
      
      await statusMessage.edit({ embeds: [errorEmbed] });
    }
  },

  async removeUserFromWatch(message, username, channelId, { dataManager }) {
    const settings = dataManager.getChannelSettings(channelId);
    const stalkerWatching = settings.stalkerWatching || {};
    
    if (!stalkerWatching[username]) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Utilisateur non surveillé')
        .setDescription(`**${username}** n'est pas dans la liste de surveillance de ce salon.`)
        .addFields({
          name: '📋 Voir la liste',
          value: 'Utilisez `!stalker list` pour voir tous les utilisateurs surveillés.'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }
    
    delete stalkerWatching[username];
    
    dataManager.setChannelSettings(channelId, {
      stalkerWatching: stalkerWatching
    });
    
    await dataManager.save();
    
    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('✅ Surveillance supprimée')
      .setDescription(`**${username}** a été retiré de la surveillance.`)
      .addFields({
        name: '🗑️ Action effectuée',
        value: 'Les transactions de cet utilisateur ne seront plus surveillées dans ce salon.'
      })
      .setTimestamp();
    
    await message.reply({ embeds: [embed] });
  },

  async showWatchedUsers(message, channelId, { dataManager }) {
    const settings = dataManager.getChannelSettings(channelId);
    const stalkerWatching = settings.stalkerWatching || {};
    
    const watchedUsers = Object.keys(stalkerWatching);
    
    if (watchedUsers.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('📋 Aucune surveillance active')
        .setDescription('Aucun utilisateur n\'est actuellement surveillé dans ce salon.')
        .addFields({
          name: '💡 Pour démarrer',
          value: '`!stalker <username>` pour ajouter un utilisateur à surveiller'
        })
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }
    
    const embed = new EmbedBuilder()
      .setColor('#9C27B0')
      .setTitle('👥 Utilisateurs surveillés')
      .setDescription(`**${watchedUsers.length}** utilisateur(s) surveillé(s) dans ce salon`)
      .setTimestamp();

    let usersList = '';
    watchedUsers.forEach((username, index) => {
      const userData = stalkerWatching[username];
      const addedDate = new Date(userData.addedAt).toLocaleDateString('fr-FR');
      
      usersList += `**${index + 1}.** 👤 **${username}**\n`;
      usersList += `   └ 💼 ${userData.wallet.substring(0, 25)}...\n`;
      usersList += `   └ 🏷️ Namespace: ${userData.namespace} | 📅 ${addedDate}\n\n`;
    });

    embed.addFields({
      name: '🔍 Liste des surveillances',
      value: usersList,
      inline: false
    });

    embed.addFields({
      name: '⚡ Configuration',
      value: '• **Réseau:** Polygon (MATIC)\n• **Fréquence:** Vérification toutes les 30 secondes\n• **Notifications:** Automatiques dans ce salon',
      inline: false
    });

    // Ajouter des boutons d'action
    const actionRow = new ActionRowBuilder();
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('stalker_stop_all')
        .setLabel('Arrêter toutes les surveillances')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔕')
    );

    await message.reply({ 
      embeds: [embed],
      components: [actionRow]
    });
  },

  async showStalkerStatus(message, channelId, { dataManager }) {
    const settings = dataManager.getChannelSettings(channelId);
    const stalkerWatching = settings.stalkerWatching || {};
    const watchedUsersCount = Object.keys(stalkerWatching).length;
    
    const embed = new EmbedBuilder()
      .setColor('#2196F3')
      .setTitle('📊 Statut de la Surveillance Stalker')
      .setDescription('Système de surveillance des transactions Polygon')
      .addFields(
        {
          name: '👥 Statistiques',
          value: `**Utilisateurs surveillés:** ${watchedUsersCount}\n**Réseau:** Polygon Mainnet\n**Contrat Xaya:** 0x8C12...304F`,
          inline: true
        },
        {
          name: '⚙️ Configuration',
          value: `**Fréquence:** 30 secondes\n**API:** PolygonScan\n**Notifications:** Temps réel`,
          inline: true
        },
        {
          name: '🔧 Fonctionnalités',
          value: `• Résolution automatique username → wallet\n• Surveillance transactions MATIC\n• Notifications Discord instantanées\n• Support namespaces p/sv`,
          inline: false
        }
      );

    if (watchedUsersCount > 0) {
      let recentActivity = '';
      const users = Object.entries(stalkerWatching);
      
      for (const [username, data] of users.slice(0, 3)) {
        const addedDate = new Date(data.addedAt).toLocaleDateString('fr-FR');
        recentActivity += `• **${username}** (${data.namespace}) - ${addedDate}\n`;
      }
      
      if (users.length > 3) {
        recentActivity += `... et ${users.length - 3} autre(s)`;
      }
      
      embed.addFields({
        name: '📋 Utilisateurs récents',
        value: recentActivity,
        inline: false
      });
    }

    embed.setFooter({ 
      text: 'Service actif 24/7 • Soccerverse Bot v3.0' 
    })
    .setTimestamp();

    await message.reply({ embeds: [embed] });
  },

  async showHelp(message) {
    const embed = new EmbedBuilder()
      .setColor('#9C27B0')
      .setTitle('👥 Commande Stalker - Surveillance Polygon')
      .setDescription('Surveillez les transactions des utilisateurs Soccerverse sur Polygon')
      .addFields(
        {
          name: '📝 Commandes disponibles',
          value: 
            '**`!stalker <username>`** - Ajouter un utilisateur à surveiller\n' +
            '**`!stalker <username> remove`** - Arrêter la surveillance\n' +
            '**`!stalker list`** - Liste des utilisateurs surveillés\n' +
            '**`!stalker status`** - Statut du système de surveillance',
          inline: false
        },
        {
          name: '💡 Exemples d\'utilisation',
          value: 
            '`!stalker GamblerTheOne` - Surveiller GamblerTheOne\n' +
            '`!stalker klo` - Surveiller klo\n' +
            '`!stalker GamblerTheOne remove` - Arrêter surveillance\n' +
            '`!stalker list` - Voir tous les utilisateurs surveillés',
          inline: false
        },
        {
          name: '🔧 Fonctionnement',
          value: 
            '• **Résolution automatique:** username → adresse wallet Polygon\n' +
            '• **Surveillance temps réel:** Vérification toutes les 30 secondes\n' +
            '• **Notifications:** Alerte Discord pour chaque nouvelle transaction\n' +
            '• **Support:** Namespaces "p" et "sv" du contrat Xaya',
          inline: false
        },
        {
          name: '⚠️ Informations importantes',
          value: 
            '• Commande réservée aux administrateurs\n' +
            '• Nécessite un nom d\'utilisateur valide sur Soccerverse\n' +
            '• Surveille uniquement les transactions MATIC sur Polygon\n' +
            '• Les données sont sauvegardées par salon Discord',
          inline: false
        }
      )
      .setFooter({ text: 'Commande expérimentale • Utilisez avec précaution • Soccerverse Bot v3.0' });

    await message.reply({ embeds: [embed] });
  },

  // =================== BLOCKCHAIN UTILITIES ===================

  async resolveUsernameToWallet(username) {
    try {
      // Configuration Polygon
      const POLYGON_RPC_URL = 'https://polygon-rpc.com';
      const XAYA_ACCOUNTS_ADDRESS = '0x8C12253F71091b9582908C8a44F78870Ec6F304F';
      
      // ABI minimal du contrat Xaya
      const XAYA_ABI = [
        {
          type: "function",
          name: "tokenIdForName",
          stateMutability: "pure",
          inputs: [
            { name: "ns", type: "string" },
            { name: "name", type: "string" },
          ],
          outputs: [{ type: "uint256" }],
        },
        {
          type: "function",
          name: "ownerOf",
          stateMutability: "view",
          inputs: [{ name: "tokenId", type: "uint256" }],
          outputs: [{ type: "address" }],
        }
      ];

      // Créer le provider et le contrat
      const provider = new ethers.providers.JsonRpcProvider(POLYGON_RPC_URL);
      const xayaContract = new ethers.Contract(XAYA_ACCOUNTS_ADDRESS, XAYA_ABI, provider);

      const namespaces = ["p", "sv"];
      let lastError;

      // Essayer chaque namespace
      for (const ns of namespaces) {
        try {
          console.log(`🔍 Recherche de "${username}" dans namespace "${ns}"...`);
          
          // Obtenir le token ID
          const tokenId = await xayaContract.tokenIdForName(ns, username);
          console.log(`📋 Token ID trouvé: ${tokenId.toString()}`);
          
          // Obtenir le propriétaire
          const wallet = await xayaContract.ownerOf(tokenId);
          console.log(`👤 Propriétaire trouvé: ${wallet}`);
          
          return {
            wallet: wallet,
            tokenId: tokenId.toString(),
            namespace: ns
          };
          
        } catch (e) {
          console.log(`❌ Namespace "${ns}" : ${e.message}`);
          lastError = e;
          continue;
        }
      }
      
      // Aucun namespace n'a fonctionné
      const errorMessage = lastError?.reason || lastError?.message || 'Utilisateur non trouvé';
      throw new Error(`"${username}" non trouvé dans les namespaces p/sv: ${errorMessage}`);
      
    } catch (error) {
      console.error('❌ Erreur résolution blockchain:', error);
      throw error;
    }
  }
};
