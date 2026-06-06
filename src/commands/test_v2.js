const { 
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, 
  SeparatorSpacingSize, SectionBuilder, ThumbnailBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');

module.exports = {
  name: 'testv2',
  description: 'Test Components V2',
  async execute(message, args, { apiClient }) {
    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## 🏆 Classement - Ligue Test\n*Composants V2 — Plus de limite 1024 chars !*')
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('🟢 **Zone Promotion**')
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '**1.** Dynamo Makhachkala II — **65pts** 33/38\n' +
          '**2.** Dinamo Kirov — **62pts** 33/38\n' +
          '**3.** Biolog — **62pts** 33/38'
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '**4.** Dinamo Vologda — **59pts** 33/38\n' +
          '**5.** Rubin Yalta — **55pts** 33/38\n' +
          '...\n' +
          '**17.** Kompozit — **31pts** 33/38\n' +
          '**18.** Rodina Moskva — **29pts** 33/38'
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('🔴 **Zone Relégation**')
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '**18.** Rodina Moskva III — **29pts** 33/38\n' +
          '**19.** Torpedo Miass — **26pts** 33/38\n' +
          '**20.** Avangard Kursk — **20pts** 33/38'
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('refresh_classement')
            .setLabel('🔄 Actualiser')
            .setStyle(ButtonStyle.Secondary)
        )
      );

    await message.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
  }
};

module.exports.slashCommand = new (require('discord.js').SlashCommandBuilder)()
  .setName('testv2')
  .setDescription('Test Components V2');
