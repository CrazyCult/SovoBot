const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  name: 'help',
  description: 'Afficher l\'aide du bot',
  usage: '!help',
  
  async execute(message, args, { apiClient, dataManager }) {
    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle('🤖 Soccerverse Bot v3.0 - Aide')
      .setDescription('Bot Discord pour suivre vos clubs Soccerverse favoris !')
      .addFields(
        {
          name: '📝 Commandes principales',
          value: 
            '**`!inscription <club_id>`** - S\'inscrire aux notifications d\'un club\n' +
            '**`!desinscription [club_id]`** - Se désinscrire des notifications\n' +
            '**`!club [id|nom]`** - Voir les infos d\'un club ou des clubs inscrits\n' +
            '**`!matchs [club_id]`** - Voir les matchs d\'un club (dernier et prochain)\n' +
            '**`!calendrier [club_id]`** - Voir le calendrier des prochains matchs\n' +
            '**`!classement [club_id]`** - Voir le classement de la ligue\n' +
            '**`!salaire [club_id]`** - Calculer le salaire club/match cible\n' +
            '**`!help`** - Afficher cette aide',
          inline: false
        },
        {
          name: '💰 Calculateur de Salaire',
          value:
            '**`!salaire [club_id]`** - Afficher les salaires cibles selon la position\n' +
            '• Salaire pour votre position actuelle\n' +
            '• Salaire pour le 1er du classement\n' +
            '• Salaire pour le milieu de tableau\n' +
            '• Salaire pour le dernier\n' +
            '• Données financières complètes du club',
          inline: false
        },
        {
          name: '🏆 Surveillance des Enchères',
          value:
            '**`!encheres`** - Démarrer surveillance pour clubs inscrits\n' +
            '**`!encheres <player_id>`** - Ajouter un joueur à surveiller\n' +
            '**`!encheres <player_id> remove`** - Retirer un joueur de la surveillance\n' +
            '**`!encheres stop`** - Arrêter toutes les surveillances\n' +
            '**`!encheres status`** - Voir le statut de la surveillance\n' +
            '**`!encheres list`** - Voir les clubs/joueurs surveillés',
          inline: false
        },
        {
          name: '💡 Exemples - Commandes générales',
          value: 
            '`!inscription 2180` - S\'inscrire au club ID 2180\n' +
            '`!club 2180` - Voir les infos du club ID 2180\n' +
            '`!club Arsenal` - Rechercher des clubs nommés "Arsenal"\n' +
            '`!club` - Voir tous les clubs inscrits dans ce salon\n' +
            '`!matchs` - Voir les matchs du club inscrit\n' +
            '`!calendrier 2180 10` - Voir 10 prochains matchs du club\n' +
            '`!classement` - Voir le classement de la ligue du club inscrit\n' +
            '`!salaire 3227` - Calculer les salaires cibles pour le club 3227',
          inline: false
        },
        {
          name: '💡 Exemples - Enchères',
          value: 
            '`!encheres` - Surveiller enchères des clubs inscrits\n' +
            '`!encheres 467622` - Surveiller enchères du joueur ID 467622\n' +
            '`!encheres 467622 remove` - Retirer le joueur de la surveillance\n' +
            '`!encheres status` - Voir statut surveillance\n' +
            '`!encheres stop` - Arrêter toutes surveillances\n' +
            '`!encheres list` - Voir configuration actuelle',
          inline: false
        },
        {
          name: '🔔 Notifications automatiques',
          value: 
            '• **Matchs :** Deadlines de composition (6h/3h/1h avant)\n' +
            '• **Résultats :** Score final automatiquement après les matchs\n' +
            '• **Enchères :** Dépassements + fins imminentes (30/15/5/1 min)\n' +
            '  └ Notification de fin + suppression auto quand enchère terminée\n' +
            '  └ Vous êtes mentionné (@vous) dans chaque notification',
          inline: false
        },
        {
          name: '🏆 Fonctionnement des enchères',
          value: 
            '• **Dépassements :** Alerte immédiate quand votre enchère est dépassée\n' +
            '• **Fins imminentes :** Rappels à 30, 15, 5 et 1 minute(s) avant fin\n' +
            '• **Fin d\'enchère :** Notification finale avec vainqueur et prix\n' +
            '• **Suppression auto :** Le joueur est retiré automatiquement quand l\'enchère se termine\n' +
            '• **Suppression manuelle :** `!encheres <player_id> remove`\n' +
            '• **Types surveillés :** Enchères de vos clubs + joueurs spécifiques\n' +
            '• **Fréquence :** Vérification toutes les 60 secondes\n' +
            '• **Smart :** Pas de spam, notifications uniques et intelligentes',
          inline: false
        },
        {
          name: '💰 Calculateur de Salaire - Détails',
          value: 
            '• **Salaires cibles :** Calculés selon votre position dans la ligue\n' +
            '• **Données complètes :** Base de fans, capacité stade, prix billet, droits TV\n' +
            '• **Simulations :** Salaires pour 1er, milieu de tableau, et dernier\n' +
            '• **Recommandations :** Salaire club/match optimal pour équilibrer votre budget\n' +
            '• **Basé sur :** Revenus de billetterie, sponsoring, merchandising, TV, et primes',
          inline: false
        },
        {
          name: '🎯 Comment trouver l\'ID d\'un club ou joueur ?',
          value: 
            '• **Clubs :** Utilisez `!club <nom>` pour rechercher par nom\n' +
            '• **Joueurs :** L\'ID apparaît dans l\'URL sur Soccerverse.com\n' +
            '• **Exemple club :** soccerverse.com/clubs/2180 → ID = 2180\n' +
            '• **Exemple joueur :** soccerverse.com/player/467622 → ID = 467622',
          inline: false
        },
        {
          name: '📋 Fonctionnement par salon',
          value: 
            '• **Par salon Discord :** Chaque salon peut avoir ses propres clubs\n' +
            '• **Plusieurs clubs :** Vous pouvez suivre plusieurs clubs par salon\n' +
            '• **Permissions :** Certaines commandes nécessitent les droits admin\n' +
            '• **Sauvegarde :** Toutes les configurations sont sauvegardées automatiquement',
          inline: false
        },
        {
          name: '🆘 Support et informations',
          value: 
            '• **Problème avec le bot ?** Contactez les développeurs\n' +
            '• **Suggestions d\'améliorations** bienvenues !\n' +
            '• **Version actuelle :** 3.0.0 avec calculateur de salaires\n' +
            '• **Source :** Bot non officiel pour la communauté Soccerverse',
          inline: false
        }
      )
      .setFooter({ 
        text: 'Soccerverse Bot v3.0 • Bot non officiel pour la communauté', 
        iconURL: 'https://downloads.soccerverse.com/default_profile.jpg' 
      })
      .setTimestamp();

    // Ajouter les statistiques et commandes admin si admin
    const isAdmin = message.member?.permissions?.has(PermissionFlagsBits.Administrator) || false;
    
    if (isAdmin) {
      // Section commandes admin
      embed.addFields({
        name: '⚙️ Commandes Admin (Cachées)',
        value: 
          '**Surveillance avancée :**\n' +
          '• `!gastracker start/stop/status` - Gas Polygon\n' +
          '• `!orderbook [club_id] [min] [max]` - Orderbook\n' +
          '• `!stalker <username>` - Transactions utilisateurs\n' +
          '**Gestion :**\n' +
          '• `!notifications [status|test|reset]`\n' +
          '• `!update` - MAJ mappings\n' +
          '• `!reload <commande>` - Recharger commande',
        inline: false
      });

      // Statistiques
      const stats = dataManager.getStats();
      embed.addFields({
        name: '📊 Statistiques',
        value: 
          `• **Salons actifs :** ${stats.totalChannels}\n` +
          `• **Clubs uniques :** ${stats.totalClubs}\n` +
          `• **Inscriptions totales :** ${stats.totalRegistrations}\n` +
          `• **Moyenne par salon :** ${stats.averageClubsPerChannel}`,
        inline: false
      });
    }

    await message.reply({ embeds: [embed] });
  }
};

