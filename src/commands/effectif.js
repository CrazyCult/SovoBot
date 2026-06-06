const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');
const axios = require('axios');

// Barème salaires officiel Soccerverse
const SALARY_TABLE = {
  50: 1250, 51: 1275, 52: 1300, 53: 1325, 54: 1350, 55: 1380,
  56: 1400, 57: 1430, 58: 1450, 59: 1480, 60: 1500,
  61: 1800, 62: 2160, 63: 2590, 64: 3105, 65: 3730,
  66: 4470, 67: 5360, 68: 6430, 69: 7710, 70: 9260,
  71: 11100, 72: 13300, 73: 16000, 74: 19200, 75: 23000,
  76: 27600, 77: 33100, 78: 39800, 79: 47700, 80: 57300,
  81: 68700, 82: 82400, 83: 98930, 84: 119000, 85: 142000,
  86: 170940, 87: 205000, 88: 246160, 89: 295380, 90: 354460,
  91: 423500, 92: 510420, 93: 612500, 94: 735000, 95: 882000,
  96: 1060000, 97: 1275843, 98: 1531012, 99: 1837214
};

// Ordre des postes
const POSITION_ORDER = ['GK', 'RB', 'CB', 'LB', 'DMC', 'CM', 'RM', 'LM', 'AMC', 'AMR', 'AML', 'FC'];

function getExpectedSalary(ovr) {
  if (ovr < 50) return SALARY_TABLE[50];
  if (ovr > 99) return SALARY_TABLE[99];
  return SALARY_TABLE[ovr] || null;
}

function getSalaryEmoji(actualSalary, ovr) {
  const expected = getExpectedSalary(ovr);
  if (!expected) return '⚪';
  const ratio = actualSalary / expected;
  if (ratio < 0.85) return '🔵'; // Sous-payé → bonne affaire entraîneur
  if (ratio > 1.15) return '🔴'; // Surpayé
  if (ratio < 0.95 || ratio > 1.05) return '🟡'; // Légèrement hors barème
  return '🟢'; // Correct
}

function formatSalary(wages) {
  const daily = Math.round(wages / 10000);
  if (daily >= 1000) return `${(daily/1000).toFixed(1)}k`;
  return `${daily}`;
}

function getPositionOrder(pos) {
  const idx = POSITION_ORDER.indexOf(pos);
  return idx === -1 ? 99 : idx;
}

module.exports = {
  name: 'effectif',
  description: 'Afficher l\'effectif d\'un club avec salaires',
  usage: '!effectif [club_id]',
  async execute(message, args, { apiClient, dataManager }) {
    let clubId = args[0];

    if (!clubId) {
      const channelId = message.channel.id;
      const clubs = dataManager.getChannelClubs(channelId);
      if (clubs.length === 0) {
        return message.reply('❌ Aucun club inscrit. Utilisez `!effectif <club_id>`');
      }
      clubId = clubs[0];
    }

    clubId = parseInt(clubId);
    if (isNaN(clubId)) {
      return message.reply('❌ ID de club invalide.');
    }

    try {
      await message.reply('⏳ Chargement de l\'effectif...');

      // Récupérer les joueurs via datacentre API
      const response = await axios.get(
        `https://services.soccerverse.com/api/players/detailed?club_id=${clubId}&per_page=100`,
        { timeout: 10000 }
      );

      const players = response.data.items;

      // Récupérer les notes projetées en parallèle (soccerratings.org)
      const projectedRatings = {};
      try {
        const ratingPromises = players.map(p =>
          axios.get(`https://soccerratings.org/api/player/${p.player_id}`, { timeout: 5000 })
            .then(r => { projectedRatings[p.player_id] = r.data.projected_rating?.overall || null; })
            .catch(() => { projectedRatings[p.player_id] = null; })
        );
        await Promise.all(ratingPromises);
      } catch(e) {
        logger.warn('Notes projetées non disponibles:', e.message);
      }
      if (!players || players.length === 0) {
        return message.reply('❌ Aucun joueur trouvé pour ce club.');
      }

      const clubName = apiClient.getClubName(clubId);

      // Trier par poste
      players.sort((a, b) => {
        const posA = getPositionOrder(a.position_main);
        const posB = getPositionOrder(b.position_main);
        if (posA !== posB) return posA - posB;
        return b.rating - a.rating;
      });

      // Grouper par poste
      const byPosition = {};
      for (const player of players) {
        const pos = player.position_main || 'N/A';
        if (!byPosition[pos]) byPosition[pos] = [];
        byPosition[pos].push(player);
      }

      const embed = new EmbedBuilder()
        .setColor('#E67E22')
        .setTitle(`👥 Effectif — ${clubName}`)
        .setThumbnail(`https://elrincondeldt.com/sv/photos/teams/${clubId}.png`)
        .setFooter({ text: `🔵 Sous-payé • 🟢 Correct • 🟡 Léger écart • 🔴 Surpayé • Soccerverse Bot v3.0` })
        .setTimestamp();

      // Afficher par groupe de postes
      for (const pos of POSITION_ORDER) {
        const group = byPosition[pos];
        if (!group || group.length === 0) continue;

        let fieldText = '';
        for (const p of group) {
          const name = apiClient.getPlayerName(p.player_id) || `Joueur #${p.player_id}`;
          const link = `https://play.soccerverse.com/player/${p.player_id}`;
          const salary = Math.round(p.wages / 10000);
          const salaryEmoji = getSalaryEmoji(salary, p.rating);
          const injuredIcon = p.injured ? '🏥' : '';
          const age = p.age || '?';
          const salaryStr = formatSalary(p.wages);

          const proj = projectedRatings[p.player_id];
          let projStr = '';
          if (proj !== null && proj !== undefined) {
            const diff = proj - p.rating;
            if (diff > 0) projStr = ' 🟩+' + diff;
            else if (diff < 0) projStr = ' 🟥' + diff;
            else projStr = ' 🟦0';
          }
          fieldText += `[${name}](${link}) | ⭐${p.rating}${projStr} | ${age}ans | 💰${salaryStr} ${salaryEmoji}${injuredIcon}\n`;
        }

        if (fieldText.length > 1024) fieldText = fieldText.substring(0, 1020) + '...';

        embed.addFields({
          name: `**${pos}**`,
          value: fieldText,
          inline: false
        });
      }

      // Postes non mappés
      for (const [pos, group] of Object.entries(byPosition)) {
        if (POSITION_ORDER.includes(pos)) continue;
        let fieldText = '';
        for (const p of group) {
          const name = apiClient.getPlayerName(p.player_id) || `Joueur #${p.player_id}`;
          const link = `https://play.soccerverse.com/player/${p.player_id}`;
          const salary = Math.round(p.wages / 10000);
          const salaryEmoji = getSalaryEmoji(salary, p.rating);
          fieldText += `[${name}](${link}) | ⭐${p.rating} | ${p.age}ans | 💰${formatSalary(p.wages)} ${salaryEmoji}\n`;
        }
        embed.addFields({ name: `**${pos}**`, value: fieldText, inline: false });
      }

      await message.reply({ embeds: [embed] });

    } catch (error) {
      logger.error('Erreur commande effectif:', error);
      await message.reply('❌ Erreur lors du chargement de l\'effectif.');
    }
  }
};

module.exports.slashCommand = new (require('discord.js').SlashCommandBuilder)()
  .setName('effectif')
  .setDescription('Afficher l\'effectif d\'un club avec salaires')
  .addStringOption(opt => opt
    .setName('club')
    .setDescription('ID ou nom du club (vide = club inscrit)')
    .setRequired(false)
  );
