const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'notifications',
  description: 'Gérer les notifications de composition d\'équipe (admin)',
  usage: '!notifications [status|test|reset]',
  
  async execute(message, args, { apiClient, dataManager, matchNotificationWatcher }) {
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
        await this.showNotificationStatus(message, { dataManager, matchNotificationWatcher });
        break;
        
      case 'test':
        await this.testNotifications(message, { dataManager, matchNotificationWatcher });
        break;
        
      case 'reset':
        await this.resetNotifications(message, { matchNotificationWatcher });
        break;
        
      default:
        await this.showHelp(message);
    }
  },

  async showNotificationStatus(message, { dataManager, matchNotificationWatcher }) {
    const stats = matchNotificationWatcher.getNotificationStats();
    const registeredClubs = dataManager.getAllRegisteredClubs();
    const channelCount = Object.keys(dataManager.data.registrations).length;

    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('📊 Statut des Notifications de Match')
      .setDescription('Surveillance automatique des deadlines de composition d\'équipe')
      .addFields(
        {
          name: '🎯 Configuration',
          value: 
            `**Notifications:** 6h, 3h, 1h avant deadline\n` +
            `**Vérification:** Toutes les ${stats.checkInterval} minutes\n` +
            `**Deadline:** 2h avant le début du match`,
          inline: false
        },
        {
          name: '📈 Statistiques',
          value: 
            `**Clubs surveillés:** ${registeredClubs.length}\n` +
            `**Canaux actifs:** ${channelCount}\n` +
            `**Notifications envoyées:** ${stats.sentNotificationsCount}`,
          inline: true
        },
        {
          name: '⚙️ État du service',
          value: '🟢 **Actif**\nSurveillance en cours...',
          inline: true
        }
      )
      .setFooter({ text: 'Les notifications sont envoyées automatiquement dans tous les canaux où le club est inscrit' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  },

  async testNotifications(message, { dataManager, matchNotificationWatcher }) {
    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('🔄 Test des notifications en cours...')
      .setDescription('Vérification forcée de tous les matchs à venir...')
      .setFooter({ text: 'Cette opération peut prendre quelques secondes' });

    const statusMessage = await message.reply({ embeds: [embed] });

    try {
      await matchNotificationWatcher.forceCheck();
      
      const successEmbed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Test terminé')
        .setDescription('Vérification forcée effectuée avec succès.')
        .addFields({
          name: '📝 Résultat',
          value: 'Toutes les notifications éligibles ont été traitées.\nConsultez les logs pour plus de détails.',
          inline: false
        })
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

  async resetNotifications(message, { matchNotificationWatcher }) {
    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('⚠️ Confirmation requise')
      .setDescription('Voulez-vous vraiment réinitialiser le cache des notifications ?')
      .addFields({
        name: '📝 Conséquences',
        value: 'Cela permettra de renvoyer des notifications déjà envoyées.\nUtile en cas de test ou de problème.',
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
        matchNotificationWatcher.resetNotificationCache();
        
        const successEmbed = new EmbedBuilder()
          .setColor('#4CAF50')
          .setTitle('✅ Cache réinitialisé')
          .setDescription('Le cache des notifications a été vidé avec succès.')
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

  async showHelp(message) {
    const embed = new EmbedBuilder()
      .setColor('#2196F3')
      .setTitle('📋 Commande Notifications')
      .setDescription('Gestion des notifications de composition d\'équipe')
      .addFields(
        {
          name: '📊 Commandes disponibles',
          value: 
            '**`!notifications status`** - Afficher le statut du service\n' +
            '**`!notifications test`** - Forcer une vérification immédiate\n' +
            '**`!notifications reset`** - Réinitialiser le cache des notifications',
          inline: false
        },
        {
          name: '⚽ Fonctionnement',
          value: 
            '• **Automatic:** Les notifications sont envoyées automatiquement\n' +
            '• **Timing:** 6h, 3h et 1h avant la deadline de composition\n' +
            '• **Deadline:** 2h avant le début du match\n' +
            '• **Scope:** Tous les clubs inscrits dans tous les canaux',
          inline: false
        }
      )
      .setFooter({ text: 'Commande réservée aux administrateurs • Soccerverse Bot v3.0' });

    await message.reply({ embeds: [embed] });
  }
};
