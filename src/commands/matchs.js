const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'matchs',
  description: 'Afficher les matchs d\'un club (dernier et prochain)',
  usage: '!matchs [club_id]',
  
  async execute(message, args, { apiClient, dataManager }) {
    const channelId = message.channel.id;
    let clubId;

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
            value: '• `!matchs` - Matchs du club inscrit\n• `!matchs <club_id>` - Matchs d\'un club spécifique'
          })
          .addFields({
            name: '📝 Pour s\'inscrire',
            value: '`!inscription <club_id>`'
          })
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await message.reply({ embeds: [embed] });
        return;
      }

      // Si plusieurs clubs inscrits, prendre le premier
      clubId = parseInt(registeredClubs[0]);
      
      // Si plus d'un club inscrit, afficher un message informatif
      if (registeredClubs.length > 1) {
        const clubNames = [];
        for (const id of registeredClubs.slice(0, 3)) {
          clubNames.push(apiClient.getClubName(parseInt(id)));
        }
        
        const embed = new EmbedBuilder()
          .setColor('#2196F3')
          .setTitle('📋 Plusieurs clubs inscrits')
          .setDescription(`Affichage des matchs de **${apiClient.getClubName(clubId)}** (premier club inscrit).`)
          .addFields({
            name: '🏟️ Clubs inscrits dans ce salon',
            value: clubNames.join(', ') + (registeredClubs.length > 3 ? `... et ${registeredClubs.length - 3} autre(s)` : '')
          })
          .addFields({
            name: '💡 Astuce',
            value: 'Utilisez `!matchs <club_id>` pour un club spécifique'
          })
          .setFooter({ text: 'Soccerverse Bot v3.0' });
        
        await message.reply({ embeds: [embed] });
      }
    } else {
      // Arguments fournis
      clubId = parseInt(args[0]);
    }
    
    // Vérifier que l'ID est un nombre
    if (isNaN(clubId)) {
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ ID invalide')
        .setDescription('L\'ID du club doit être un nombre.')
        .addFields({
          name: 'Exemple valide',
          value: '`!matchs 2180`'
        });
      
      await message.reply({ embeds: [embed] });
      return;
    }

    try {
      // Récupérer les infos du club pour le nom
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
      
      // Récupérer le dernier et le prochain match
      let lastMatch = null;
      let nextMatch = null;
      
      try {
        lastMatch = await apiClient.getClubLastMatch(clubId);
        console.log('✅ Dernier match récupéré:', lastMatch);
      } catch (error) {
        console.log(`⚠️ Pas de dernier match pour ${clubId}: ${error.message}`);
      }
      
      try {
        nextMatch = await apiClient.getClubNextMatch(clubId);
        console.log('✅ Prochain match récupéré:', nextMatch);
      } catch (error) {
        console.log(`⚠️ Pas de prochain match pour ${clubId}: ${error.message}`);
      }
      
      // Créer l'embed principal
      const embed = new EmbedBuilder()
        .setColor('#2196F3')
        .setTitle(`⚽ Matchs de ${clubData.display_name}`)
        .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`)
        .setDescription(`**Manager:** ${clubData.manager_name}\n**Pays:** ${apiClient.formatCountryName(clubData.country_id)}`);

      // Ajouter le dernier match si disponible
      if (lastMatch) {
        const matchDate = new Date(lastMatch.date * 1000);
        const isHome = lastMatch.home_club == clubId;
        const opponentName = isHome ? lastMatch.away_club_name : lastMatch.home_club_name;
        const venue = isHome ? '🏟️ Domicile' : '✈️ Extérieur';
        const result = `${lastMatch.home_goals}-${lastMatch.away_goals}`;
        
        // Déterminer le résultat pour le club
        let matchResult = '';
        const clubGoals = isHome ? lastMatch.home_goals : lastMatch.away_goals;
        const opponentGoals = isHome ? lastMatch.away_goals : lastMatch.home_goals;
        
        if (clubGoals > opponentGoals) {
          matchResult = '🟢 Victoire';
        } else if (clubGoals < opponentGoals) {
          matchResult = '🔴 Défaite';
        } else {
          matchResult = '⚪ Nul';
        }
        
        // Manager adverse
        const opponentManager = isHome ? lastMatch.away_manager : lastMatch.home_manager;
        
        embed.addFields({
          name: '🏁 Dernier match',
          value: `${matchResult} vs **${opponentName}**\n` +
                 `👤 Entraineur: ${opponentManager || 'Inconnu'}\n` +
                 `📍 ${venue} • ⚽ **${result}**\n` +
                 `📅 ${matchDate.toLocaleDateString('fr-FR')}\n` +
                 `🏆 ${lastMatch.competition_type}`,
          inline: true
        });
      } else {
        embed.addFields({
          name: '🏁 Dernier match',
          value: 'Aucun match joué récemment',
          inline: true
        });
      }

      // Ajouter le prochain match si disponible
      if (nextMatch) {
        const matchDate = new Date(nextMatch.date * 1000);
        const isHome = nextMatch.home_club == clubId;
        const opponentName = isHome ? nextMatch.away_club_name : nextMatch.home_club_name;
        const venue = isHome ? '🏟️ Domicile' : '✈️ Extérieur';
        
        // Manager adverse
        const opponentManager = isHome ? nextMatch.away_manager : nextMatch.home_manager;
        
        embed.addFields({
          name: '⏰ Prochain match',
          value: `⏳ vs **${opponentName}**\n` +
                 `👤 Entraineur: ${opponentManager || 'Inconnu'}\n` +
                 `📍 ${venue} • 🏟️ ${nextMatch.stadium_name}\n` +
                 `📅 ${matchDate.toLocaleDateString('fr-FR')} à ${matchDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}\n` +
                 `🏆 ${nextMatch.competition_type}`,
          inline: true
        });
      } else {
        embed.addFields({
          name: '⏰ Prochain match',
          value: 'Aucun match programmé',
          inline: true
        });
      }

      // Ajouter une ligne vide pour l'alignement si on a les deux matchs
      if (lastMatch && nextMatch) {
        embed.addFields({
          name: '\u200b',
          value: '\u200b',
          inline: true
        });
      }

      // Informations supplémentaires
      if (lastMatch || nextMatch) {
        embed.addFields({
          name: '📋 Informations',
          value: `**ID Club:** ${clubId}\n` +
                 `**Division:** ${clubData.division + 1}\n` +
                 `**Stade:** ${apiClient.getStadiumName(clubData.stadium_id)}`,
          inline: false
        });
      }

      embed.setFooter({ text: `Club ID: ${clubId} • Soccerverse Bot v3.0` })
           .setTimestamp();

      await message.reply({ embeds: [embed] });

    } catch (error) {
      console.error('❌ Erreur dans la commande matchs:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setTitle('❌ Erreur')
        .setDescription('Une erreur est survenue lors de la récupération des matchs.')
        .addFields({
          name: '💡 Suggestions',
          value: '• Vérifiez que l\'ID du club est correct\n• Réessayez dans quelques instants'
        })
        .addFields({
          name: '🔧 Détails techniques',
          value: `\`\`\`${error.message}\`\`\``
        })
        .setFooter({ text: 'Soccerverse Bot v3.0' });
      
      await message.reply({ embeds: [errorEmbed] });
    }
  }
};
module.exports.slashCommand = new (require('discord.js').SlashCommandBuilder)()
  .setName('matchs')
  .setDescription('Afficher les matchs d\'un club')
  .addStringOption(opt => opt
    .setName('club')
    .setDescription('ID ou nom du club (vide = clubs inscrits)')
    .setRequired(false)
  );
