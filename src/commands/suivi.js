const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'suivi',
  description: 'Suivre automatiquement vos clubs avec un nombre minimum de parts (en rotation intelligente)',
  usage: '!suivi <pseudo> <min_parts> [start|stop|status]',

  async execute(message, args, { apiClient, dataManager, clubFollowerWatcher }) {
    const channelId = message.channel.id;

    // !suivi status
    if (args.length === 1 && args[0].toLowerCase() === 'status') {
      return await this.showStatus(message, channelId, { clubFollowerWatcher });
    }

    // !suivi stop
    if (args.length === 1 && args[0].toLowerCase() === 'stop') {
      return await this.stopFollowing(message, channelId, { clubFollowerWatcher });
    }

    // !suivi stop <club_id> - Retirer un club spécifique
    if (args.length === 2 && args[0].toLowerCase() === 'stop' && !isNaN(args[1])) {
      const clubId = parseInt(args[1]);
      return await this.removeClub(message, channelId, clubId, { clubFollowerWatcher, apiClient });
    }

    // !suivi <club_id> - Ajouter un club spécifique
    if (args.length === 1 && !isNaN(args[0])) {
      const clubId = parseInt(args[0]);
      return await this.addSingleClub(message, channelId, clubId, { clubFollowerWatcher, apiClient });
    }

    // !suivi <pseudo> <min_parts> - Suivre un portefeuille
    if (args.length >= 2) {
      const username = args[0];
      const minInfluence = parseInt(args[1]);

      if (isNaN(minInfluence) || minInfluence < 0) {
        const embed = new EmbedBuilder()
          .setColor('#FF6B6B')
          .setTitle('❌ Nombre de parts invalide')
          .setDescription('Le nombre minimum de parts doit être un nombre positif.')
          .addFields({
            name: 'Exemples',
            value: '• `!suivi CrazyCult 100` - Suivre les clubs avec au moins 100 parts\n' +
                   '• `!suivi 2180` - Suivre un club spécifique par son ID'
          });

        await message.reply({ embeds: [embed] });
        return;
      }

      return await this.startFollowing(message, channelId, username, minInfluence, { clubFollowerWatcher, apiClient });
    }

    // Afficher l'aide
    await this.showHelp(message);
  },

  async startFollowing(message, channelId, username, minInfluence, { clubFollowerWatcher, apiClient }) {
    // Vérifier si déjà actif
    const currentStatus = clubFollowerWatcher.getFollowingStatus(channelId);
    if (currentStatus) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Suivi déjà actif')
        .setDescription(`Un suivi est déjà en cours dans ce salon pour **${currentStatus.username}**.`)
        .addFields({
          name: '📊 Configuration actuelle',
          value: `• **Pseudo:** ${currentStatus.username}\n` +
                 `• **Min parts:** ${currentStatus.minInfluence}\n` +
                 `• **Clubs suivis:** ${currentStatus.clubCount}\n` +
                 `• **Prochaine vérif:** ~${currentStatus.nextCheckIn}min`
        }, {
          name: '💡 Actions',
          value: '• `!suivi stop` - Arrêter le suivi\n' +
                 '• `!suivi status` - Voir le statut détaillé'
        });

      await message.reply({ embeds: [embed] });
      return;
    }

    // Afficher un message de chargement
    const loadingEmbed = new EmbedBuilder()
      .setColor('#5865f2')
      .setTitle('⏳ Initialisation du suivi...')
      .setDescription(`Récupération des clubs de **${username}** avec au moins **${minInfluence} parts**...\n\n` +
                      '⚠️ Cette opération peut prendre quelques minutes.')
      .setFooter({ text: 'Merci de patienter' });

    const loadingMsg = await message.reply({ embeds: [loadingEmbed] });

    try {
      // Démarrer le suivi
      const result = await clubFollowerWatcher.startFollowing(
        channelId,
        username,
        minInfluence,
        message.author.id
      );

      if (!result.success) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF6B6B')
          .setTitle('❌ Erreur')
          .setDescription(result.error)
          .addFields({
            name: '💡 Vérifications',
            value: '• Le pseudo existe-t-il ?\n' +
                   '• Avez-vous des parts dans des clubs ?\n' +
                   '• Le nombre minimum de parts est-il correct ?'
          });

        await loadingMsg.edit({ embeds: [errorEmbed] });
        return;
      }

      // Succès !
      const successEmbed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Suivi activé !')
        .setDescription(`Le suivi intelligent est maintenant actif pour **${username}**`)
        .addFields({
          name: '📊 Configuration',
          value: `• **Pseudo:** ${username}\n` +
                 `• **Min parts:** ${minInfluence}\n` +
                 `• **Clubs trouvés:** ${result.totalClubs}\n` +
                 `• **Clubs suivis:** ${result.followedClubs}${result.excludedClubs > 0 ? `\n• **Exclus (déjà suivis ailleurs):** ${result.excludedClubs}` : ''}`,
          inline: false
        }, {
          name: '🔄 Fonctionnement',
          value: '• **Rotation intelligente:** 1 club vérifié toutes les 3 minutes\n' +
                 '• **Notifications:** Uniquement pour les nouveautés\n' +
                 '• **Types de changements:** Forme, actualités, classement, manager, trésorerie\n' +
                 '• **Pas de spam:** Système de cache intelligent',
          inline: false
        }, {
          name: '📋 Commandes',
          value: '• `!suivi status` - Voir le statut détaillé\n' +
                 '• `!suivi stop` - Arrêter le suivi',
          inline: false
        })
        .setFooter({ text: `Lancé par ${message.author.username}` })
        .setTimestamp();

      // Ajouter des boutons
      const actionRow = new ActionRowBuilder();
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId('follower_status')
          .setLabel('📊 Voir le statut')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📊'),
        new ButtonBuilder()
          .setCustomId('follower_stop')
          .setLabel('⏹️ Arrêter')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('⏹️')
      );

      await loadingMsg.edit({
        embeds: [successEmbed],
        components: [actionRow]
      });

    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription('Une erreur est survenue lors de l\'initialisation du suivi.')
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        });

      await loadingMsg.edit({ embeds: [errorEmbed] });
    }
  },

  async addSingleClub(message, channelId, clubId, { clubFollowerWatcher, apiClient }) {
    const loadingEmbed = new EmbedBuilder()
      .setColor('#5865f2')
      .setTitle('⏳ Ajout du club...')
      .setDescription(`Vérification du club #${clubId}...`)
      .setFooter({ text: 'Merci de patienter' });

    const loadingMsg = await message.reply({ embeds: [loadingEmbed] });

    try {
      const result = await clubFollowerWatcher.addClubToFollow(channelId, clubId, message.author.id);

      if (!result.success) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF6B6B')
          .setTitle('❌ Erreur')
          .setDescription(result.error);

        await loadingMsg.edit({ embeds: [errorEmbed] });
        return;
      }

      // Succès !
      const successEmbed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Club ajouté au suivi !')
        .setDescription(`**${result.clubName}** est maintenant suivi dans ce salon`)
        .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${result.clubId}.png`)
        .addFields({
          name: '📊 Club',
          value: `[${result.clubName}](https://play.soccerverse.com/club/${result.clubId}) (#${result.clubId})`,
          inline: false
        }, {
          name: '🔄 Fonctionnement',
          value: '• **Rotation intelligente:** Vérifié toutes les 3 minutes\n' +
                 '• **Notifications:** Uniquement pour les nouveautés\n' +
                 '• **Types:** Forme, actualités, classement, manager, trésorerie',
          inline: false
        }, {
          name: '📋 Commandes',
          value: '• `!suivi status` - Voir le statut\n' +
                 '• `!suivi <autre_club_id>` - Ajouter un autre club\n' +
                 '• `!suivi stop` - Arrêter tout le suivi',
          inline: false
        })
        .setFooter({ text: `Ajouté par ${message.author.username}` })
        .setTimestamp();

      // Ajouter des boutons
      const actionRow = new ActionRowBuilder();
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId('follower_status')
          .setLabel('📊 Voir le statut')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📊'),
        new ButtonBuilder()
          .setCustomId('follower_stop')
          .setLabel('⏹️ Arrêter')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('⏹️')
      );

      await loadingMsg.edit({
        embeds: [successEmbed],
        components: [actionRow]
      });

    } catch (error) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription('Une erreur est survenue lors de l\'ajout du club.')
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        });

      await loadingMsg.edit({ embeds: [errorEmbed] });
    }
  },

  async stopFollowing(message, channelId, { clubFollowerWatcher }) {
    const result = clubFollowerWatcher.stopFollowing(channelId);

    if (!result.success) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Aucun suivi actif')
        .setDescription('Aucun suivi n\'est en cours dans ce salon.')
        .addFields({
          name: '💡 Pour démarrer',
          value: '`!suivi <pseudo> <min_parts>` - Démarrer le suivi'
        });

      await message.reply({ embeds: [embed] });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('✅ Suivi arrêté')
      .setDescription(`Le suivi automatique a été arrêté dans ce salon par <@${message.author.id}>`)
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  },

  async removeClub(message, channelId, clubId, { clubFollowerWatcher, apiClient }) {
    const result = clubFollowerWatcher.removeClubFromFollowing(channelId, clubId);

    if (!result.success) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription(result.error)
        .addFields({
          name: '💡 Aide',
          value: '• `!suivi status` - Voir les clubs suivis\n' +
                 '• `!suivi stop <club_id>` - Retirer un club du suivi'
        });

      await message.reply({ embeds: [embed] });
      return;
    }

    // Si c'était le dernier club, le suivi est arrêté
    if (result.remainingClubs === 0) {
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Club retiré et suivi arrêté')
        .setDescription(`**${result.clubName}** (#${result.clubId}) a été retiré du suivi.\n\n` +
                        `C'était le dernier club suivi, le suivi automatique a donc été arrêté.`)
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      return;
    }

    // Le club a été retiré mais d'autres clubs restent
    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('✅ Club retiré du suivi')
      .setDescription(`**${result.clubName}** (#${result.clubId}) a été retiré du suivi avec succès.`)
      .addFields({
        name: '📊 Statut',
        value: `**${result.remainingClubs}** club(s) encore suivi(s) dans ce salon`
      })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  },

  async showStatus(message, channelId, { clubFollowerWatcher }) {
    const status = clubFollowerWatcher.getFollowingStatus(channelId);

    if (!status) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('📊 Aucun suivi actif')
        .setDescription('Aucun suivi n\'est configuré dans ce salon.')
        .addFields({
          name: '💡 Pour démarrer',
          value: '`!suivi <pseudo> <min_parts>` - Démarrer le suivi\n\n' +
                 '**Exemple:**\n' +
                 '`!suivi CrazyCult 100` - Suivre les clubs avec au moins 100 parts'
        });

      await message.reply({ embeds: [embed] });
      return;
    }

    const startedDate = new Date(status.startedAt);
    const runningTime = Date.now() - status.startedAt;
    const runningHours = Math.floor(runningTime / 3600000);
    const runningMinutes = Math.floor((runningTime % 3600000) / 60000);

    const embed = new EmbedBuilder()
      .setColor('#5865f2')
      .setTitle('📊 Statut du Suivi')
      .setDescription(`Suivi actif pour **${status.username}**`)
      .addFields({
        name: '⚙️ Configuration',
        value: `• **Pseudo:** ${status.username}\n` +
               `• **Min parts:** ${status.minInfluence}\n` +
               `• **Clubs suivis:** ${status.clubCount}\n` +
               `• **Rotation:** 1 club toutes les 3 minutes`,
        inline: true
      }, {
        name: '📈 Statistiques',
        value: `• **Démarré le:** ${startedDate.toLocaleDateString('fr-FR')}\n` +
               `• **Durée:** ${runningHours}h ${runningMinutes}min\n` +
               `• **Démarré par:** <@${status.startedBy}>\n` +
               `• **Club en cours:** ${status.currentIndex + 1}/${status.clubCount}`,
        inline: true
      }, {
        name: '🔄 Prochaine vérification',
        value: `Dans ~${status.nextCheckIn} minutes`,
        inline: false
      }, {
        name: '📋 Commandes',
        value: '• `!suivi stop` - Arrêter le suivi\n' +
               '• `!suivi status` - Rafraîchir le statut',
        inline: false
      })
      .setFooter({ text: 'Soccerverse Bot v3.0' })
      .setTimestamp();

    // Ajouter des boutons
    const actionRow = new ActionRowBuilder();
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId('follower_status')
        .setLabel('🔄 Rafraîchir')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄'),
      new ButtonBuilder()
        .setCustomId('follower_stop')
        .setLabel('⏹️ Arrêter')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('⏹️')
    );

    await message.reply({
      embeds: [embed],
      components: [actionRow]
    });
  },

  async showHelp(message) {
    const embed = new EmbedBuilder()
      .setColor('#5865f2')
      .setTitle('📊 Commande !suivi - Aide')
      .setDescription('Suivez automatiquement vos clubs avec une rotation intelligente !')
      .addFields({
        name: '🚀 Suivre votre portefeuille',
        value: '`!suivi <pseudo> <min_parts>`\n\n' +
               '**Paramètres:**\n' +
               '• `<pseudo>` - Votre pseudo Soccerverse\n' +
               '• `<min_parts>` - Nombre minimum de parts\n\n' +
               '**Exemple:**\n' +
               '`!suivi CrazyCult 100` - Suivre les clubs avec au moins 100 parts',
        inline: false
      }, {
        name: '➕ Ajouter un club spécifique',
        value: '`!suivi <club_id>`\n\n' +
               '**Exemple:**\n' +
               '`!suivi 2180` - Suivre le club #2180\n\n' +
               '💡 Utile pour suivre un club qui ne fait pas partie de votre portefeuille',
        inline: false
      }, {
        name: '🔄 Fonctionnement',
        value: '• **Rotation intelligente:** 1 club vérifié toutes les 3 minutes\n' +
               '• **Anti-doublons:** Empêche de suivre le même club dans plusieurs de vos salons\n' +
               '• **Multi-utilisateurs:** Plusieurs utilisateurs peuvent suivre les mêmes clubs\n' +
               '• **Notifications ciblées:** Uniquement en cas de changement\n' +
               '• **Cache partagé:** Optimise les requêtes API',
        inline: false
      }, {
        name: '📰 Changements détectés',
        value: '• 📊 Changement de forme\n' +
               '• 📍 Changement de position au classement\n' +
               '• 💰 Variation significative de trésorerie (>10%)\n' +
               '• 👨‍💼 Changement de manager ou inactivité\n' +
               '• 📰 Nouvelles actualités (blessures, transferts, suspensions...)',
        inline: false
      }, {
        name: '📋 Autres commandes',
        value: '• `!suivi status` - Voir le statut du suivi\n' +
               '• `!suivi stop` - Arrêter tout le suivi\n' +
               '• `!suivi stop <club_id>` - Retirer un club spécifique du suivi',
        inline: false
      })
      .setFooter({ text: 'Soccerverse Bot v3.0' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
};

module.exports.slashCommand = new (require('discord.js').SlashCommandBuilder)()
  .setName('suivi')
  .setDescription('Afficher les clubs suivis dans ce salon');
