const { EmbedBuilder } = require('discord.js');

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
            '**`!help`** - Afficher cette aide',
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
          name: '⛽ Surveillance du Gas Polygon',
          value:
            '**`!gastracker start`** - Activer la surveillance du gas dans ce salon\n' +
            '**`!gastracker stop`** - Arrêter la surveillance\n' +
            '**`!gastracker status`** - Voir le statut actuel\n' +
            '**`!gastracker format <format>`** - Personnaliser l\'affichage\n' +
            '**`!gastracker update`** - Forcer une mise à jour',
          inline: false
        },
        {
          name: '📊 Surveillance Orderbook',
          value: 
            '**`!orderbook [club_id] [min] [max]`** - Surveiller les ordres de parts\n' +
            '**`!watchlist`** - Gérer les surveillances orderbook actives\n' +
            '**`!watchlist stop [club_id]`** - Arrêter surveillance orderbook\n' +
            '**`!stopwatch [club_id]`** - Arrêter rapidement une surveillance',
          inline: false
        },
        {
          name: '👥 Surveillance Utilisateurs (Stalker)',
          value: 
            '**`!stalker <username>`** - Surveiller les transactions d\'un utilisateur\n' +
            '**`!stalker <username> remove`** - Arrêter surveillance d\'un utilisateur\n' +
            '**`!stalker list`** - Voir tous les utilisateurs surveillés\n' +
            '**`!stalker status`** - Statut du service stalker',
          inline: false
        },
        {
          name: '⚙️ Commandes admin',
          value: 
            '**`!notifications [status|test|reset]`** - Gérer les notifications (admin)\n' +
            '**`!nextresults`** - Voir les prochains résultats programmés (admin)\n' +
            '**`!update`** - Mettre à jour les mappings de noms (admin)\n' +
            '**`!reload <commande>`** - Recharger une commande (admin)\n' +
            '**`!stalkeradmin [status|test|reset]`** - Admin service stalker (admin)',
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
            '`!classement` - Voir le classement de la ligue du club inscrit',
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
          name: '💡 Exemples - Orderbook',
          value: 
            '`!orderbook 2180` - Voir l\'orderbook du club 2180\n' +
            '`!orderbook 2180 1000 5000` - Surveiller ordres entre 1000$ et 5000$\n' +
            '`!watchlist` - Voir toutes les surveillances orderbook\n' +
            '`!stopwatch` - Arrêter rapidement toutes les surveillances',
          inline: false
        },
        {
          name: '💡 Exemples - Stalker',
          value: 
            '`!stalker CrazyCult` - Surveiller les transactions de CrazyCult\n' +
            '`!stalker GamblerTheOne` - Surveiller GamblerTheOne\n' +
            '`!stalker CrazyCult remove` - Arrêter surveillance\n' +
            '`!stalker list` - Voir tous les utilisateurs surveillés',
          inline: false
        },
        {
          name: '🔔 Notifications automatiques',
          value: 
            '• **Matchs :** Deadlines de composition (6h/3h/1h avant)\n' +
            '• **Résultats :** Score final automatiquement après les matchs\n' +
            '• **Enchères :** Dépassements + fins imminentes (30/15/5/1 min)\n' +
            '  └ Notification de fin + suppression auto quand enchère terminée\n' +
            '  └ Vous êtes mentionné (@vous) dans chaque notification\n' +
            '• **Orderbook :** Nouveaux ordres selon vos critères\n' +
            '• **Stalker :** Transactions de parts des utilisateurs surveillés',
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
            '• **Version actuelle :** 3.0.0 avec surveillance enchères complète\n' +
            '• **Source :** Bot non officiel pour la communauté Soccerverse',
          inline: false
        }
      )
      .setFooter({ 
        text: 'Soccerverse Bot v3.0 • Bot non officiel pour la communauté', 
        iconURL: 'https://downloads.soccerverse.com/default_profile.jpg' 
      })
      .setTimestamp();

    // Ajouter les statistiques si demandé par un admin
    if (message.member && message.member.permissions.has('ADMINISTRATOR')) {
      const stats = dataManager.getStats();
      embed.addFields({
        name: '📊 Statistiques (Admin)',
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
