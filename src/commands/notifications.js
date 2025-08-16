const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'notifications',
  description: 'Gérer les notifications de composition d\'équipe et résultats (admin)',
  usage: '!notifications [status|test|reset|results]',
  
  async execute(message, args, { apiClient, dataManager, matchNotificationWatcher, matchResultWatcher }) {
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

    if (!matchNotificationWatcher) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Service indisponible')
        .setDescription('Le service de notifications de match n\'est pas initialisé.')
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const action = args[0]?.toLowerCase();

    switch (action) {
      case 'status':
        await this.showNotificationStatus(message, { dataManager, matchNotificationWatcher, matchResultWatcher });
        break;
        
      case 'test':
        await this.testNotifications(message, { dataManager, matchNotificationWatcher, matchResultWatcher });
        break;
        
      case 'reset':
        await this.resetNotifications(message, { matchNotificationWatcher, matchResultWatcher });
        break;
        
      case 'results':
        await this.showResultsStatus(message, { matchResultWatcher });
        break;
        
      default:
        await this.showHelp(message);
    }
  },

  async showNotificationStatus(message, { dataManager, matchNotificationWatcher, matchResultWatcher }) {
    const notificationStats = matchNotificationWatcher.getNotificationStats();
    const resultStats = matchResultWatcher ? matchResultWatcher.getResultStats() : null;
    const registeredClubs = dataManager.getAllRegisteredClubs();
    const channelCount = Object.keys(dataManager.data.registrations).length;

    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('📊 Statut des Notifications de Match')
      .setDescription('Services de surveillance automatique des matchs')
      .addFields(
        {
          name: '🔔 Notifications de Composition',
          value: 
            `**Timing:** 6h, 3h, 1h avant deadline\n` +
            `**Vérification:** Toutes les ${notificationStats.checkInterval} minutes\n` +
            `**Deadline:** 2h avant le début du match\n` +
            `**Statut:** 🟢 Actif`,
          inline: true
        },
        {
          name: '🏆 Notifications de Résultats',
          value: resultStats ? 
            `**Méthode:** ${resultStats.method}\n` +
            `**Délai:** ${resultStats.resultDelay} minute après le match\n` +
            `**Reprogrammation:** Toutes les ${resultStats.schedulingInterval}\n` +
            `**Matchs traités:** ${resultStats.processedMatchesCount}\n` +
            `**Statut:** 🟢 Actif` :
            `**Statut:** ❌ Non initialisé`,
          inline: true
        },
        {
          name: '📈 Statistiques Générales',
          value: 
            `**Clubs surveillés:** ${registeredClubs.length}\n` +
            `**Canaux actifs:** ${channelCount}\n` +
            `**Notifications composition:** ${notificationStats.sentNotificationsCount}`,
          inline: false
        }
      )
      .setFooter({ text: 'Tous les services fonctionnent en arrière-plan automatiquement' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  },

  async testNotifications(message, { dataManager, matchNotificationWatcher, matchResultWatcher }) {
    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('🔄 Test des notifications en cours...')
      .setDescription('Vérification forcée de tous les services...')
      .addFields({
        name: '⏳ Opérations en cours',
        value: '• Test notifications de composition\n• Test notifications de résultats\n• Vérification état des services'
      })
      .setFooter({ text: 'Cette opération peut prendre quelques secondes' });

    const statusMessage = await message.reply({ embeds: [embed] });

    try {
      let compositionResult = 'N/A';
      let resultResult = 'N/A';
      
      // Test notifications de composition
      try {
        await matchNotificationWatcher.forceCheck();
        compositionResult = '✅ Succès';
      } catch (error) {
        compositionResult = `❌ Erreur: ${error.message}`;
      }
      
      // Test notifications de résultats
      if (matchResultWatcher) {
        try {
          await matchResultWatcher.forceCheckResults();
          resultResult = '✅ Succès';
        } catch (error) {
          resultResult = `❌ Erreur: ${error.message}`;
        }
      } else {
        resultResult = '⚠️ Service non initialisé';
      }
      
      const successEmbed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Test terminé')
        .setDescription('Vérification forcée effectuée avec succès.')
        .addFields(
          {
            name: '🔔 Notifications Composition',
            value: compositionResult,
            inline: true
          },
          {
            name: '🏆 Notifications Résultats',
            value: resultResult,
            inline: true
          },
          {
            name: '📝 Note',
            value: 'Les notifications éligibles ont été traitées.\nConsultez les logs pour plus de détails.',
            inline: false
          }
        )
        .setTimestamp();

      await statusMessage.edit({ embeds: [successEmbed] });
      
    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur lors du test')
        .setDescription('Une erreur est survenue pendant la vérification forcée.')
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        });

      await statusMessage.edit({ embeds: [errorEmbed] });
    }
  },

  async resetNotifications(message, { matchNotificationWatcher, matchResultWatcher }) {
    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('⚠️ Confirmation requise')
      .setDescription('Voulez-vous vraiment réinitialiser tous les caches de notifications ?')
      .addFields({
        name: '📝 Conséquences',
        value: 'Cela va réinitialiser :\n• Cache notifications de composition\n• Cache notifications de résultats\n\nPermet de renvoyer des notifications déjà envoyées.',
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
        // Réinitialiser les caches
        matchNotificationWatcher.resetNotificationCache();
        if (matchResultWatcher) {
          matchResultWatcher.resetResultCache();
        }
        
        const successEmbed = new EmbedBuilder()
          .setColor('#4CAF50')
          .setTitle('✅ Caches réinitialisés')
          .setDescription('Tous les caches de notifications ont été vidés avec succès.')
          .addFields({
            name: '🔄 Services réinitialisés',
            value: '• ✅ Notifications de composition\n• ✅ Notifications de résultats',
            inline: false
          })
          .setTimestamp();

        await confirmMessage.edit({ embeds: [successEmbed] });
      } else {
        const cancelEmbed = new EmbedBuilder()
          .setColor('#95A5A6')
          .setTitle('❌ Opération annulée')
          .setDescription('La réinitialisation a été annulée.');

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

  async showResultsStatus(message, { matchResultWatcher }) {
    if (!matchResultWatcher) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Service indisponible')
        .setDescription('Le service de notifications de résultats n\'est pas initialisé.')
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const stats = matchResultWatcher.getResultStats();
    
    const embed = new EmbedBuilder()
      .setColor('#9C27B0')
      .setTitle('🏆 Statut des Notifications de Résultats')
      .setDescription('Service de surveillance automatique des résultats de match')
      .addFields(
        {
          name: '⚙️ Configuration',
          value: 
            `**Délai après match:** ${stats.resultDelay} minute\n` +
            `**Méthode:** ${stats.method}\n` +
            `**Reprogrammation:** Toutes les ${stats.schedulingInterval}`,
          inline: false
        },
        {
          name: '📊 Statistiques',
          value: 
            `**Matchs traités:** ${stats.processedMatchesCount}\n` +
            `**Période de rétention:** 24 heures\n` +
            `**État:** 🟢 Surveillance active`,
          inline: true
        },
        {
          name: '🔄 Fonctionnement',
          value: 
            `• Récupération des horaires de prochains matchs\n` +
            `• Programmation précise 1 minute après chaque match\n` +
            `• Vérification automatique si match terminé\n` +
            `• Re-tentative toutes les 5 minutes si pas terminé\n` +
            `• Notification dans tous les canaux inscrits`,
          inline: false
        }
      )
      .setFooter({ text: 'Les résultats sont notifiés automatiquement dès qu\'ils sont disponibles' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  },

  async showHelp(message) {
    const embed = new EmbedBuilder()
      .setColor('#2196F3')
      .setTitle('📋 Commande Notifications')
      .setDescription('Gestion complète des notifications de match')
      .addFields(
        {
          name: '📊 Commandes disponibles',
          value: 
            '**`!notifications status`** - Statut général des services\n' +
            '**`!notifications test`** - Forcer une vérification immédiate\n' +
            '**`!notifications reset`** - Réinitialiser tous les caches\n' +
            '**`!notifications results`** - Statut spécifique aux résultats',
          inline: false
        },
        {
          name: '🔔 Notifications de Composition',
          value: 
            '• **Timing:** 6h, 3h et 1h avant la deadline\n' +
            '• **Deadline:** 2h avant le début du match\n' +
            '• **Vérification:** Toutes les 30 minutes',
          inline: true
        },
        {
          name: '🏆 Notifications de Résultats',
          value: 
            '• **Timing:** Programmation précise 1 minute après chaque match\n' +
            '• **Contenu:** Score final et statistiques\n' +
            '• **Méthode:** Basée sur les horaires connus des matchs',
          inline: true
        },
        {
          name: '📡 Scope des Notifications',
          value: 
            '• **Cible:** Tous les clubs inscrits\n' +
            '• **Canaux:** Tous les canaux où le club est inscrit\n' +
            '• **Automatique:** Aucune intervention manuelle requise',
          inline: false
        }
      )
      .setFooter({ text: 'Commande réservée aux administrateurs • Soccerverse Bot v3.0' });

    await message.reply({ embeds: [embed] });
  }
};
