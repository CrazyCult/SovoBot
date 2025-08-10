const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'reload',
  description: 'Recharger une commande spécifique (commande de debug)',
  usage: '!reload <nom_commande>',
  
  async execute(message, args, { apiClient, dataManager }) {
    // Vérifier les permissions (optionnel - seulement pour les admins)
    if (!message.member.permissions.has('ADMINISTRATOR')) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Permissions insuffisantes')
        .setDescription('Cette commande est réservée aux administrateurs.')
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    if (args.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('📋 Commande reload')
        .setDescription('Recharge une commande spécifique pour appliquer les modifications.')
        .addFields({
          name: '💡 Usage',
          value: '`!reload <nom_commande>`'
        })
        .addFields({
          name: '📝 Exemple',
          value: '`!reload classement`'
        })
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    const commandName = args[0].toLowerCase();
    
    try {
      // Supprimer le module du cache
      const commandPath = require.resolve(`./${commandName}.js`);
      delete require.cache[commandPath];
      
      // Recharger la commande
      const newCommand = require(`./${commandName}.js`);
      
      // Mettre à jour dans la collection des commandes du bot
      // (Accès via le client Discord)
      const bot = message.client.bot || message.client;
      if (bot && bot.commands) {
        bot.commands.set(commandName, newCommand);
      }
      
      const embed = new EmbedBuilder()
        .setColor('#4CAF50')
        .setTitle('✅ Commande rechargée')
        .setDescription(`La commande **${commandName}** a été rechargée avec succès.`)
        .addFields({
          name: '🔄 Statut',
          value: 'Les modifications sont maintenant actives.'
        })
        .setFooter({ text: 'Soccerverse Bot v3.0' })
        .setTimestamp();
      
      await message.reply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Erreur rechargement commande:', error);
      
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur de rechargement')
        .setDescription(`Impossible de recharger la commande **${commandName}**.`)
        .addFields({
          name: '🔧 Détails',
          value: `\`\`\`${error.message}\`\`\``
        })
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [embed] });
    }
  }
};
