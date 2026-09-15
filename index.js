const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ⚙️ CONFIGURAÇÕES DA SUA LOJA
const CONFIG = {
  TOKEN: process.env.DISCORD_TOKEN || 'SEU_DISCORD_TOKEN_AQUI',
  MERCADO_PAGO_TOKEN: process.env.MP_TOKEN || 'SEU_MERCADO_PAGO_ACCESS_TOKEN_AQUI',
  // 🖼️ URL DO GIF DE ENTREGA AUTOMÁTICA
  BANNER_GIF: 'https://media.giphy.com/media/3oKIPa2TdahY8LAAxy/giphy.gif',
  COR_EMBED: '#a855f7' // Roxo estilo Emorfz Hub
};

// 📁 BANCO DE DADOS LOCAL SIMPLES (JSON)
const DB_FILE = path.join(__dirname, 'database.json');
let db = { products: [], stock: {}, orders: [] };

if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { console.error('Erro ao ler banco de dados', e); }
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// 🤖 INICIALIZAÇÃO DO BOT DISCORD
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

// 🎨 CRIAR EMBED DA LOJA (COM GIF NO TOPO)
function createStoreEmbed() {
  const embed = new EmbedBuilder()
    .setTitle('🌶️ PIMENTA STORE | Vendas Automáticas ⚡')
    .setDescription('Selecione o produto abaixo para comprar via Pix automático com entrega imediata na DM!')
    .setColor(CONFIG.COR_EMBED)
    // 🖼️ GIF DE ENTREGA AUTOMÁTICA NO TOPO DA EMBED
    .setImage(CONFIG.BANNER_GIF)
    .setTimestamp()
    .setFooter({ text: '⚡ Entrega Automática via DM após confirmação do Pix ✅' });

  if (db.products.length === 0) {
    embed.addFields({ name: '📦 Produtos', value: 'Nenhum produto cadastrado no momento.', inline: false });
  } else {
    db.products.forEach(p => {
      const estoque = (db.stock[p.id] || []).length;
      embed.addFields({
        name: `📦 ${p.name} — R$ ${Number(p.price).toFixed(2).replace('.', ',')}`,
        value: `📝 ${p.description || 'Sem descrição'}\n🟢 Estoque: ${estoque > 0 ? `${estoque} disponível` : '❌ Esgotado'}\n⚡ Entrega: Instantânea na DM`,
        inline: false
      });
    });
  }

  return embed;
}

// 🎛️ CRIAR MENU SELECT DOS PRODUTOS
function createStoreMenu() {
  const options = db.products.map(p => {
    const estoque = (db.stock[p.id] || []).length;
    return {
      label: p.name,
      description: `R$ ${Number(p.price).toFixed(2).replace('.', ',')} | Estoque: ${estoque}`,
      value: p.id,
      emoji: '⚡'
    };
  });

  if (options.length === 0) {
    options.push({ label: 'Nenhum produto disponível', value: 'none', description: 'Aguarde novos estoques' });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('select_product')
    .setPlaceholder('🛒 Clique aqui para selecionar o produto...')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

// 📩 TRATAMENTO DE INTERAÇÕES E COMANDOS
client.on('interactionCreate', async (interaction) => {
  // COMANDO /LOJA OU !LOJA
  if (interaction.isChatInputCommand() && interaction.commandName === 'loja') {
    const embed = createStoreEmbed();
    const components = [createStoreMenu()];
    await interaction.reply({ embeds: [embed], components: components });
  }

  // SELEÇÃO DE PRODUTO NO MENU
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_product') {
    const productId = interaction.values[0];
    if (productId === 'none') {
      return interaction.reply({ content: '❌ Nenhum produto selecionado.', ephemeral: true });
    }

    const produto = db.products.find(p => p.id === productId);
    const estoque = db.stock[productId] || [];

    if (!produto || estoque.length === 0) {
      return interaction.reply({ content: '❌ Este produto está esgotado no momento!', ephemeral: true });
    }

    // EMBED DE CONFIRMAÇÃO E PAGAMENTO
    const payEmbed = new EmbedBuilder()
      .setTitle(`🛒 Checkout: ${produto.name}`)
      .setDescription(`Você está adquirindo **${produto.name}**\n💰 Valor: **R$ ${Number(produto.price).toFixed(2).replace('.', ',')}**\n\n⚡ *A entrega será feita automaticamente na sua mensagem direta (DM) após o pagamento.*`)
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

// 🚀 REGISTRO DO COMANDO E LOGIN
client.on('ready', async () => {
  const data = [
    {
      name: 'loja',
      description: 'Exibe o painel de compras da Pimenta Store com entrega automática',
    },
  ];
  await client.application.commands.set(data);
});

client.login(CONFIG.TOKEN);
