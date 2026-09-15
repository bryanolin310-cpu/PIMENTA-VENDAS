const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

// ⚙️ CONFIGURAÇÕES DA SUA LOJA E VARIÁVEIS DE AMBIENTE
const CONFIG = {
  TOKEN: process.env.DISCORD_TOKEN,
  MERCADO_PAGO_TOKEN: process.env.MP_TOKEN,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  BANNER_GIF: 'https://media.giphy.com/media/3oKIPa2TdahY8LAAxy/giphy.gif',
  COR_EMBED: '#a855f7' // Roxo estilo Emorfz Hub
};

// 🗄️ CONEXÃO COM O SUPABASE
const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// 🌐 SERVIDOR EXPRESS PARA MANTER ON
const app = express();
app.get('/', (req, res) => res.send('Bot Pimenta Store Online ⚡'));
app.listen(process.env.PORT || 8080);

// 🤖 CLIENTE DISCORD
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ]
});

client.once('ready', () => {
  console.log(`✅ Bot PIMENTA STORE online como: ${client.user.tag}`);
});

// 🎨 BUSCAR PRODUTOS E ESTOQUE NO SUPABASE E CRIAR A EMBED
async function createStoreEmbed() {
  const embed = new EmbedBuilder()
    .setTitle('🌶️ PIMENTA STORE | Vendas Automáticas ⚡')
    .setDescription('Selecione o produto abaixo para comprar via Pix automático com entrega imediata na DM!')
    .setColor(CONFIG.COR_EMBED)
    .setImage(CONFIG.BANNER_GIF)
    .setTimestamp()
    .setFooter({ text: '⚡ Entrega Automática via DM após confirmação do Pix ✅' });

  // Buscar produtos ativos do Supabase
  const { data: products, error } = await supabase.from('products').select('*').eq('active', true);

  if (error || !products || products.length === 0) {
    embed.addFields({ name: '📦 Produtos', value: 'Nenhum produto cadastrado no momento.', inline: false });
    return embed;
  }

  for (const p of products) {
    // Contar estoque disponível no Supabase
    const { count } = await supabase
      .from('stock')
      .select('*', { count: 'exact', head: true })
      .eq('product_id', p.id)
      .eq('is_used', false);

    const estoqueNum = count || 0;

    embed.addFields({
      name: `📦 ${p.name} — R$ ${Number(p.price).toFixed(2).replace('.', ',')}`,
      value: `📝 ${p.description || 'Sem descrição'}\n🟢 Estoque: ${estoqueNum > 0 ? `${estoqueNum} disponível` : '❌ Esgotado'}\n⚡ Entrega: Instantânea na DM`,
      inline: false
    });
  }

  return embed;
}

// 🎛️ CRIAR MENU SELECT DOS PRODUTOS
async function createStoreMenu() {
  const { data: products } = await supabase.from('products').select('*').eq('active', true);

  const options = [];

  if (products && products.length > 0) {
    for (const p of products) {
      const { count } = await supabase
        .from('stock')
        .select('*', { count: 'exact', head: true })
        .eq('product_id', p.id)
        .eq('is_used', false);

      options.push({
        label: p.name,
        description: `R$ ${Number(p.price).toFixed(2).replace('.', ',')} | Estoque: ${count || 0}`,
        value: p.id,
        emoji: '⚡'
      });
    }
  }

  if (options.length === 0) {
    options.push({ label: 'Nenhum produto disponível', value: 'none', description: 'Aguarde novos estoques' });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('select_product')
    .setPlaceholder('🛒 Clique aqui para selecionar o produto...')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

// 📩 INTERAÇÕES DE COMANDOS E BOTÕES
client.on('interactionCreate', async (interaction) => {
  // COMANDO /LOJA
  if (interaction.isChatInputCommand() && interaction.commandName === 'loja') {
    await interaction.deferReply();
    const embed = await createStoreEmbed();
    const components = [await createStoreMenu()];
    await interaction.editReply({ embeds: [embed], components: components });
  }

  // SELEÇÃO NO MENU DE PRODUTOS
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_product') {
    const productId = interaction.values[0];
    if (productId === 'none') {
      return interaction.reply({ content: '❌ Nenhum produto selecionado.', ephemeral: true });
    }

    const { data: produto } = await supabase.from('products').select('*').eq('id', productId).single();
    const { count } = await supabase.from('stock').select('*', { count: 'exact', head: true }).eq('product_id', productId).eq('is_used', false);

    if (!produto || !count || count === 0) {
      return interaction.reply({ content: '❌ Este produto está esgotado no momento!', ephemeral: true });
    }

    const payEmbed = new EmbedBuilder()
      .setTitle(`🛒 Checkout: ${produto.name}`)
      .setDescription(`Você está adquirindo **${produto.name}**\n💰 Valor: **R$ ${Number(produto.price).toFixed(2).replace('.', ',')}**\n\n⚡ *A entrega será feita automaticamente na sua DM após a confirmação.*`)
      .setColor(CONFIG.COR_EMBED)
      .setFooter({ text: 'Pimenta Store — Sistema Automático' });

    const btnPay = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pix_${produto.id}`)
        .setLabel('Gerar Pix Automático')
        .setStyle(ButtonStyle.Success)
        .setEmoji('💳')
    );

    await interaction.reply({ embeds: [payEmbed], components: [btnPay], ephemeral: true });
  }
});

// REGISTRO DE COMANDOS
client.on('ready', async () => {
  await client.application.commands.set([
    {
      name: 'loja',
      description: 'Exibe o painel de compras da Pimenta Store com Supabase',
    },
  ]);
});

client.login(CONFIG.TOKEN);
