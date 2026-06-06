const { 
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SeparatorSpacingSize, SectionBuilder, ThumbnailBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const logger = require('../utils/logger');
const axios = require('axios');

const POS_MAP = {
  1:'GK', 2:'CB', 4:'CB', 8:'LB', 16:'RB', 32:'LB', 64:'RB',
  128:'DMC', 256:'DMC', 512:'CM', 1024:'LM', 2048:'RM',
  4096:'FC', 8192:'FL', 16384:'FR', 32768:'AMR', 65536:'AML', 131072:'AMC'
};

function getPos(position, positions) {
  if (positions && positions.length > 0) return positions.slice(0,3).join('/');
  return POS_MAP[position] || '?';
}

function fmtTime(unix) {
  const diff = unix - Date.now() / 1000;
  if (diff <= 0) return 'Expiré';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h >= 24) return `${Math.floor(h/24)}j${h%24}h`;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

function fmtPrice(val) {
  if (!val) return '?';
  const svc = val / 10000;
  if (svc >= 1000000) return `${Math.round(svc/1000000)}M`;
  if (svc >= 1000) {
    const k = svc/1000;
    return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(1)}K`;
  }
  return `${Math.round(svc)}`;
}

function shortName(full) {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return full;
  return parts[0][0] + '. ' + parts.slice(1).join(' ');
}

let cache = null;
let cacheTime = 0;
const TTL = 30 * 60 * 1000;

async function buildMarche(apiClient) {
  const result = await apiClient.makeRpcRequest('get_top_transfer_auctions', { num: 10000 });
  const all = result.data || result;
  const started = all.filter(a => a.started);

  await Promise.all(started.map(async a => {
    try {
      const det = await apiClient.makeRpcRequest('get_transfer_auction_details', { player_id: a.player_id });
      const d = det.data || det;
      a.end_time = d.end_time || null;
      a.high_bid = d.high_bid || null;
      a.minnextbid = d.minnextbid || null;
      a.position = d.position || a.position;
      // Postes via datacentre
      try {
        const dc = await axios.get(`https://services.soccerverse.com/api/players/detailed?player_id=${a.player_id}&per_page=5`, { timeout: 4000 });
        const dp = dc.data.items?.[0];
        if (dp) { a.positions = dp.positions; a.position_main = dp.position_main; }
      } catch(e) {}
    } catch(e) {}
  }));

  started.sort((a, b) => (a.end_time || 9e9) - (b.end_time || 9e9));
  const top10 = started.slice(0, 10);

  const proj = {};
  await Promise.all(top10.map(p =>
    axios.get(`https://soccerratings.org/api/player/${p.player_id}`, { timeout: 4000 })
      .then(r => { proj[p.player_id] = r.data.projected_rating?.overall || null; })
      .catch(() => {})
  ));

  return { started, top10, proj };
}

function buildContainer(started, top10, proj, apiClient) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 🏷️ Marché des Transferts\n**${started.length}** enchères actives • 10 plus urgentes`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  let text = '';
  for (const p of top10) {
    const name = shortName(apiClient.getPlayerName(p.player_id) || `#${p.player_id}`);
    const pos = getPos(p.position, p.positions);
    const cur = p.rating;
    const pr = proj[p.player_id];
    const diff = pr !== null && pr !== undefined ? pr - cur : null;
    const projStr = diff !== null ? (diff > 0 ? ` 🟩+${diff}` : diff < 0 ? ` 🟥${diff}` : ` 🟦=`) : '';
    const time = p.end_time ? fmtTime(p.end_time) : '?';
    const bid = p.high_bid ? fmtPrice(p.high_bid.amount) : (p.minnextbid ? fmtPrice(p.minnextbid) : '?');
    const link = `https://play.soccerverse.com/player/${p.player_id}`;
    const age = p.age || (p.dob ? Math.floor((Date.now()/1000 - p.dob) / 31557600) : '?');
    const nameT = name.length > 11 ? name.substring(0,10)+'..' : name;
    const posT = pos.length > 8 ? pos.substring(0,7)+'..' : pos;
    const projT = projStr ? projStr.trim() : '  ';
    const bidT = bid.length > 6 ? bid.substring(0,6) : bid;
    const line = `${nameT.padEnd(12)}${posT.padEnd(9)}⭐${String(cur).padEnd(3)}${projT.padEnd(6)} ${String(age).padEnd(2)}a ${time.padEnd(7)}${bidT}`;
    text += `[\`${line}\`](${link})\n`;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(text.trimEnd())
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('marche_refresh')
        .setLabel('🔄 Actualiser')
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return container;
}

module.exports = {
  name: 'marche',
  description: 'Afficher les enchères de transfert en cours',
  usage: '!marche',
  async execute(message, args, { apiClient }) {
    try {
      logger.info('🏷️ Cache check: ' + (cache ? 'existe' : 'vide') + ' age=' + Math.round((Date.now()-cacheTime)/1000) + 's TTL=' + TTL/1000 + 's');
      if (cache && Date.now() - cacheTime < TTL) {
        return message.reply({
          components: [cache],
          flags: MessageFlags.IsComponentsV2
        });
      }

      const { started, top10, proj } = await buildMarche(apiClient);
      const container = buildContainer(started, top10, proj, apiClient);

      if (top10.length > 0 && top10[0].end_time) {
        module.exports._nextExpiry = top10[0].end_time;
      }
      cache = container;
      cacheTime = Date.now();

      await message.reply({
        content: '',
        components: [cache],
        flags: MessageFlags.IsComponentsV2
      });

    } catch (error) {
      logger.error('Erreur marche:', error);
      await message.reply('❌ Erreur lors du chargement du marché.');
    }
  }
};

module.exports.preload = async function(apiClient) {
  try {
    logger.info('🏷️ Préchargement du marché...');
    const { started, top10, proj } = await buildMarche(apiClient);
    cache = buildContainer(started, top10, proj, apiClient);
    cacheTime = Date.now();
    if (top10.length > 0 && top10[0].end_time) {
      module.exports._nextExpiry = top10[0].end_time;
      module.exports.scheduleNextReload(apiClient);
    }
    logger.info('🏷️ Marché préchargé');
  } catch(e) {
    logger.warn('⚠️ Préchargement marché échoué:', e.message);
  }
};

module.exports.scheduleNextReload = function(apiClient) {
  if (!module.exports._nextExpiry) return;
  const delay = (module.exports._nextExpiry * 1000) - Date.now() + 5000;
  if (delay > 0 && delay < 24 * 3600 * 1000) {
    logger.info(`🏷️ Prochain rechargement marché dans ${Math.round(delay/60000)}min`);
    setTimeout(async () => {
      cacheTime = 0;
      await module.exports.preload(apiClient);
    }, delay);
  }
};

module.exports.slashCommand = new (require('discord.js').SlashCommandBuilder)()
  .setName('marche')
  .setDescription('Afficher les enchères de transfert en cours');
