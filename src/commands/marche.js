const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');
const axios = require('axios');

// Vrai mapping depuis le scout HTML officiel
const POS_MAP = {
  1:'GK', 2:'CB', 4:'CB', 8:'LB', 16:'RB', 32:'LB', 64:'RB',
  128:'DMC', 256:'DMC', 512:'CM', 1024:'LM', 2048:'RM',
  4096:'FC', 8192:'FL', 16384:'FR', 32768:'AMR', 65536:'AML', 131072:'AMC'
};

function getPos(position, multi_position) {
  const main = POS_MAP[position] || '?';
  const extras = new Set();
  const mp = multi_position || 0;
  for (const [bit, name] of Object.entries(POS_MAP)) {
    const b = parseInt(bit);
    if ((mp & b) === b && name !== main) extras.add(name);
  }
  const extraArr = [...extras].slice(0, 2);
  return extraArr.length > 0 ? `${main}/${extraArr.join('/')}` : main;
}

function fmtTime(unix) {
  const diff = unix - Date.now() / 1000;
  if (diff <= 0) return 'Expiré';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h >= 24) return `${Math.floor(h/24)}j ${h%24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtPrice(val) {
  if (!val) return '?';
  // Les valeurs sont en micro-SVC * 1000 — vérifier avec minimum_bid 51500000000 = $51.5K
  // $51.5K = 51500 SVC → 51500000000 / 1000000 = 51500 ✓
  const svc = val / 10000;
  if (svc >= 1000000) return `${(svc/1000000).toFixed(1)}M`;
  if (svc >= 1000) return `${(svc/1000).toFixed(1)}K`;
  return `${Math.round(svc)}`;
}

function shortName(full) {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return full;
  return parts[0][0] + '. ' + parts.slice(1).join(' ');
}

// Cache 30 minutes
let cache = null;
let cacheTime = 0;
const TTL = 30 * 60 * 1000;

module.exports = {
  name: 'marche',
  description: 'Afficher les enchères de transfert en cours',
  usage: '!marche',
  async execute(message, args, { apiClient }) {
    try {
      // Servir depuis le cache si valide
      if (cache && Date.now() - cacheTime < TTL) {
        return message.reply({ embeds: [cache] });
      }

      await message.reply('⏳ Chargement du marché...');

      // Toutes les enchères
      const result = await apiClient.makeRpcRequest('get_top_transfer_auctions', { num: 10000 });
      const all = (result.data || result);
      const started = all.filter(a => a.started);

      // Récupérer end_time pour toutes les enchères démarrées
      await Promise.all(started.map(async a => {
        try {
          const det = await apiClient.makeRpcRequest('get_transfer_auction_details', { player_id: a.player_id });
          const d = det.data || det;
          a.end_time = d.end_time || null;
          a.high_bid = d.high_bid || null;
          a.minnextbid = d.minnextbid || null;
          a.multi_position = d.multi_position || a.multi_position;
          a.position = d.position || a.position;
          // Récupérer postes via datacentre API
          try {
            const axios = require('axios');
            const dc = await axios.get(`https://services.soccerverse.com/api/players/detailed?player_id=${a.player_id}&per_page=5`, {timeout:4000});
            const dp = dc.data.items[0];
            if (dp) {
              a.positions = dp.positions;
              a.position_main = dp.position_main;
            }
          } catch(e2) {}
        } catch(e) {}
      }));

      // Trier par expiration
      started.sort((a, b) => (a.end_time || 9e9) - (b.end_time || 9e9));
      const top10 = started.slice(0, 10);

      // Notes projetées
      const proj = {};
      await Promise.all(top10.map(p =>
        axios.get(`https://soccerratings.org/api/player/${p.player_id}`, { timeout: 4000 })
          .then(r => { proj[p.player_id] = r.data.projected_rating?.overall || null; })
          .catch(() => {})
      ));

      // Construire le texte
      let text = '';
      for (const p of top10) {
        const name = shortName(apiClient.getPlayerName(p.player_id) || `#${p.player_id}`);
        const pos = p.positions ? p.positions.slice(0,3).join('/') : getPos(p.position, p.multi_position);
        const cur = p.rating;
        const pr = proj[p.player_id];
        const diff = pr !== undefined && pr !== null ? pr - cur : null;
        const projStr = diff !== null ? (diff > 0 ? ` 🟩+${diff}` : diff < 0 ? ` 🟥${diff}` : ` 🟦0`) : '';
        const time = p.end_time ? fmtTime(p.end_time) : '?';
        const bid = p.high_bid ? fmtPrice(p.high_bid.amount) : (p.minnextbid ? fmtPrice(p.minnextbid) : '?');
        const link = `https://play.soccerverse.com/player/${p.player_id}`;
        text += `[${name}](${link}) | **${pos}** ⭐${cur}${projStr} | ⏰${time} | 💰${bid}\n`;
      }

      const embed = new EmbedBuilder()
        .setColor('#E67E22')
        .setTitle('🏷️ Marché des Transferts')
        .setDescription(`**${started.length}** enchères actives • 10 plus urgentes`)
        .addFields({ name: '\u200b', value: text.trimEnd() || 'Aucune', inline: false })
        .setFooter({ text: 'Soccerverse Bot v3.0 • Marché • Cache 30min' })
        .setTimestamp();

      cache = embed;
      cacheTime = Date.now();

      await message.reply({ embeds: [embed] });

    } catch (error) {
      logger.error('Erreur marche:', error);
      await message.reply('❌ Erreur lors du chargement du marché.');
    }
  }
};

module.exports.slashCommand = new (require('discord.js').SlashCommandBuilder)()
  .setName('marche')
  .setDescription('Afficher les enchères de transfert en cours');

module.exports.preload = async function(apiClient) {
  try {
    logger.info('🏷️ Préchargement du marché...');
    const fakeMsg = { reply: async () => {} };
    await module.exports.execute(fakeMsg, [], { apiClient });
    logger.info('🏷️ Marché préchargé en cache');
  } catch(e) {
    logger.warn('⚠️ Préchargement marché échoué:', e.message);
  }
};
