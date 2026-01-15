const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'gastracker',
  description: 'Gérer la surveillance du prix du gas Polygon dans un salon',
  usage: '!gastracker [start|stop|status|format]',

  async execute(message, args, { dataManager, gasTrackerService }) {
    // Vérifier les permissions
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Permissions insuffisantes')
        .setDescription('Vous devez avoir la permission **Gérer les salons** pour utiliser cette commande.')
        .setFooter({ text: 'Soccerverse Bot v3.0' });

      await message.reply({ embeds: [embed] });
      return;
    }

    const subCommand = args[0]?.toLowerCase();

    // Afficher l'aide si aucun argument
    if (!subCommand) {
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('⛽ Gas Tracker Polygon')
        .setDescription('Surveillez le prix du gas Polygon en temps réel dans un nom de salon !')
        .addFields(
          {
            name: '📝 Commandes disponibles',
            value:
              '**`!gastracker start`** - Activer la surveillance dans ce salon\n' +
              '**`!gastracker stop`** - Arrêter la surveillance\n' +
              '**`!gastracker status`** - Voir le statut actuel\n' +
              '**`!gastracker format <format>`** - Personnaliser le format d\'affichage\n' +
              '**`!gastracker update`** - Forcer une mise à jour manuelle',
            inline: false
          },
          {
            name: '🎨 Format personnalisé',
            value:
              'Utilisez `{price}` pour afficher le prix.\n' +
              '**Exemple:** `!gastracker format ⛽ MATIC Gas: {price}`',
            inline: false
          },
          {
            name: '⚙️ Configuration',
            value: 'Mise à jour automatique toutes les **10 minutes**\nSource: **Etherscan API (Polygon)**',
            inline: false
          }
        )
        .setFooter({ text: 'Soccerverse Bot v3.0' })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      return;
    }

    const channelId = message.channel.id;

    switch (subCommand) {
      case 'start':
      case 'enable':
        // Activer le tracking
        const customFormat = args.slice(1).join(' ');
        const format = customFormat || '⛽│Gas: {price} Gwei';

        gasTrackerService.enableTracking(channelId, format);
        await dataManager.save();

        const startEmbed = new EmbedBuilder()
          .setColor('#4CAF50')
          .setTitle('✅ Surveillance du gas activée')
          .setDescription(`Le nom de ce salon sera mis à jour automatiquement avec le prix du gas Polygon.`)
          .addFields(
            { name: '📊 Format', value: `\`${format}\``, inline: false },
            { name: '⏱️ Fréquence', value: 'Toutes les 10 minutes', inline: true },
            { name: '🔗 Source', value: 'Etherscan API', inline: true }
          )
          .setFooter({ text: 'Le nom du salon sera mis à jour dans quelques instants.' })
          .setTimestamp();

        await message.reply({ embeds: [startEmbed] });

        // Mise à jour immédiate
        await gasTrackerService.forceUpdate();
        break;

      case 'stop':
      case 'disable':
        // Désactiver le tracking
        gasTrackerService.disableTracking(channelId);
        await dataManager.save();

        const stopEmbed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('🛑 Surveillance du gas arrêtée')
          .setDescription('Le nom du salon ne sera plus mis à jour automatiquement.')
          .setFooter({ text: 'Soccerverse Bot v3.0' })
          .setTimestamp();

        await message.reply({ embeds: [stopEmbed] });
        break;

      case 'status':
        // Afficher le statut
        const status = gasTrackerService.getStatus();
        const settings = dataManager.getChannelSettings(channelId);
        const isEnabled = settings.gasTracking?.enabled || false;

        const statusEmbed = new EmbedBuilder()
          .setColor(isEnabled ? '#4CAF50' : '#95A5A6')
          .setTitle('📊 Statut Gas Tracker')
          .addFields(
            {
              name: '🎯 Ce salon',
              value: isEnabled ? '✅ Activé' : '❌ Désactivé',
              inline: true
            },
            {
              name: '⛽ Prix actuel',
              value: status.lastGasPrice ? `${Math.round(status.lastGasPrice)} Gwei` : 'N/A',
              inline: true
            },
            {
              name: '⏰ Dernière MAJ',
              value: status.lastUpdate ? `<t:${Math.floor(status.lastUpdate / 1000)}:R>` : 'N/A',
              inline: true
            }
          );

        if (isEnabled) {
          statusEmbed.addFields({
            name: '📝 Format',
            value: `\`${settings.gasTracking.format}\``,
            inline: false
          });
        }

        statusEmbed.addFields(
          {
            name: '📈 Statistiques globales',
            value:
              `Total MAJ: ${status.stats.totalUpdates}\n` +
              `Succès: ${status.stats.successfulUpdates}\n` +
              `Erreurs API: ${status.stats.apiErrors}\n` +
              `Erreurs Discord: ${status.stats.discordErrors}`,
            inline: false
          }
        );

        statusEmbed.setFooter({ text: 'Soccerverse Bot v3.0' });
        statusEmbed.setTimestamp();

        await message.reply({ embeds: [statusEmbed] });
        break;

      case 'format':
        // Personnaliser le format
        const newFormat = args.slice(1).join(' ');

        if (!newFormat) {
          const formatEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🎨 Personnaliser le format')
            .setDescription('Définissez un format personnalisé pour l\'affichage du prix.')
            .addFields(
              {
                name: '💡 Usage',
                value: '`!gastracker format <votre_format>`',
                inline: false
              },
              {
                name: '📋 Variables disponibles',
                value: '`{price}` - Le prix du gas en Gwei (arrondi)',
                inline: false
              },
              {
                name: '📝 Exemples',
                value:
                  '`!gastracker format ⛽│Gas: {price} Gwei`\n' +
                  '`!gastracker format 💎│MATIC Gas: {price}`\n' +
                  '`!gastracker format ⚡ Polygon: {price} Gwei`',
                inline: false
              }
            )
            .setFooter({ text: 'Soccerverse Bot v3.0' });

          await message.reply({ embeds: [formatEmbed] });
          return;
        }

        if (!newFormat.includes('{price}')) {
          const errorEmbed = new EmbedBuilder()
            .setColor('#FF6B6B')
            .setTitle('❌ Format invalide')
            .setDescription('Le format doit contenir la variable `{price}`.')
            .setFooter({ text: 'Exemple: ⛽│Gas: {price} Gwei' });

          await message.reply({ embeds: [errorEmbed] });
          return;
        }

        gasTrackerService.enableTracking(channelId, newFormat);
        await dataManager.save();

        const formatSuccessEmbed = new EmbedBuilder()
          .setColor('#4CAF50')
          .setTitle('✅ Format mis à jour')
          .setDescription(`Le nouveau format a été enregistré.`)
          .addFields({
            name: '📝 Nouveau format',
            value: `\`${newFormat}\``,
            inline: false
          })
          .setFooter({ text: 'Le nom du salon sera mis à jour dans quelques instants.' })
          .setTimestamp();

        await message.reply({ embeds: [formatSuccessEmbed] });

        // Mise à jour immédiate
        await gasTrackerService.forceUpdate();
        break;

      case 'update':
      case 'refresh':
        // Force une mise à jour manuelle
        await message.reply('🔄 Mise à jour en cours...');
        await gasTrackerService.forceUpdate();

        const updateEmbed = new EmbedBuilder()
          .setColor('#4CAF50')
          .setTitle('✅ Mise à jour effectuée')
          .setDescription('Le prix du gas a été actualisé.')
          .setFooter({ text: 'Soccerverse Bot v3.0' })
          .setTimestamp();

        await message.reply({ embeds: [updateEmbed] });
        break;

      default:
        const helpEmbed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('❓ Commande inconnue')
          .setDescription('Utilisez `!gastracker` sans argument pour voir l\'aide.')
          .setFooter({ text: 'Soccerverse Bot v3.0' });

        await message.reply({ embeds: [helpEmbed] });
    }
  }
};
