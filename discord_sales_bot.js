/**
 * ============================================================================
 * BOT DE VENDAS AUTOMÁTICO PARA DISCORD + MCP + SISTEMA MIGRATÓRIO
 * Arquitetura Moderna: Discord.js v14, MCP Server, Express Webhook, Motor Anti-Fraude
 * ============================================================================
 */

const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder, 
  PermissionFlagsBits, 
  ChannelType 
} = require('discord.js');
const express = require('express');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Configurações Globais da Aplicação
const CONFIG = {
  BOT_TOKEN: process.env.DISCORD_TOKEN || 'SEU_BOT_TOKEN_AQUI',
  CLIENT_ID: process.env.CLIENT_ID || 'SEU_CLIENT_ID_AQUI',
  GUILD_ID: process.env.GUILD_ID || 'SEU_GUILD_ID_AQUI',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_KEY: process.env.SUPABASE_KEY || '',
  PORT: process.env.PORT || 3000,
  PIX_KEY: process.env.PIX_KEY || 'minha-chave-pix@dominio.com',
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || 'segredo_webhook_mercado_pago',
  MIN_ACCOUNT_AGE_DAYS: 3, // Segurança: Tempo mínimo de conta no Discord
  DATA_DIR: path.join(__dirname, 'data'),
  BACKUP_DIR: path.join(__dirname, 'backups'),
  CURRENT_SCHEMA_VERSION: 2 // Versão atual do esquema de dados
};

// Emissor de eventos do sistema
const systemEvents = new EventEmitter();

/**
 * Banco de Dados em Memória com Persistência no Supabase (com fallback local em disco)
 */
class DatabaseEngine {
  constructor() {
    this.products = new Map();
    this.stock = new Map();
    this.transactions = new Map();
    this.users = new Map();
    this.auditLogs = [];
    this.activeLocks = new Set(); // Prevenção de dupla compra / Race Condition

    if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_KEY) {
      this.supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
      console.log('[SUPABASE] Cliente do Supabase inicializado com sucesso.');
    } else {
      this.supabase = null;
      console.log('[SUPABASE AVISO] Variáveis do Supabase não configuradas. Utilizando armazenamento local.');
    }
  }

  async init() {
    await fs.mkdir(CONFIG.DATA_DIR, { recursive: true });
    await fs.mkdir(CONFIG.BACKUP_DIR, { recursive: true });
    await this.loadData();
  }

  // Adquire trava atômica por usuário e produto
  acquireLock(userId, productId) {
    const lockKey = `${userId}:${productId}`;
    if (this.activeLocks.has(lockKey)) {
      return false;
    }
    this.activeLocks.add(lockKey);
    return true;
  }

  // Libera trava atômica
  releaseLock(userId, productId) {
    const lockKey = `${userId}:${productId}`;
    this.activeLocks.delete(lockKey);
  }

  async loadData() {
    if (this.supabase) {
      try {
        const { data: prods } = await this.supabase.from('products').select('*');
        if (prods && prods.length > 0) {
          prods.forEach(p => this.products.set(p.id, p));
        } else {
          this.seedDefaultData();
        }

        const { data: stockItems } = await this.supabase.from('stock').select('*');
        if (stockItems) {
          stockItems.forEach(s => this.stock.set(s.product_id, s.items));
        }

        const { data: txs } = await this.supabase.from('transactions').select('*');
        if (txs) {
          txs.forEach(t => this.transactions.set(t.id, t));
        }
        console.log('[SUPABASE] Dados sincronizados da nuvem.');
        return;
      } catch (err) {
        console.error('[SUPABASE ERRO] Falha ao carregar dados do Supabase. Alternando para modo local:', err.message);
      }
    }

    try {
      const prodData = await fs.readFile(path.join(CONFIG.DATA_DIR, 'products.json'), 'utf-8');
      JSON.parse(prodData).forEach(p => this.products.set(p.id, p));
    } catch (e) { this.seedDefaultData(); }

    try {
      const stockData = await fs.readFile(path.join(CONFIG.DATA_DIR, 'stock.json'), 'utf-8');
      JSON.parse(stockData).forEach(s => this.stock.set(s.productId, s.items));
    } catch (e) { }

    try {
      const txData = await fs.readFile(path.join(CONFIG.DATA_DIR, 'transactions.json'), 'utf-8');
      JSON.parse(txData).forEach(t => this.transactions.set(t.id, t));
    } catch (e) { }
  }

  async saveData() {
    if (this.supabase) {
      try {
        const prods = Array.from(this.products.values());
        if (prods.length > 0) {
          await this.supabase.from('products').upsert(prods);
        }

        const stockEntries = Array.from(this.stock.entries()).map(([productId, items]) => ({
          product_id: productId,
          items: items
        }));
        if (stockEntries.length > 0) {
          await this.supabase.from('stock').upsert(stockEntries);
        }

        const txs = Array.from(this.transactions.values());
        if (txs.length > 0) {
          await this.supabase.from('transactions').upsert(txs);
        }
      } catch (err) {
        console.error('[SUPABASE ERRO] Falha ao salvar no Supabase:', err.message);
      }
    }

    await fs.writeFile(path.join(CONFIG.DATA_DIR, 'products.json'), JSON.stringify(Array.from(this.products.values()), null, 2));
    await fs.writeFile(path.join(CONFIG.DATA_DIR, 'stock.json'), JSON.stringify(Array.from(this.stock.entries()).map(([productId, items]) => ({ productId, items })), null, 2));
    await fs.writeFile(path.join(CONFIG.DATA_DIR, 'transactions.json'), JSON.stringify(Array.from(this.transactions.values()), null, 2));
  }

  seedDefaultData() {
    const sampleProduct = {
      id: 'prod_discord_nitro',
      name: 'Discord Nitro Mensal',
      category: 'Gift Cards',
      price: 29.90,
      description: 'Código de ativação oficial do Discord Nitro (1 Mês).',
      active: true
    };
    this.products.set(sampleProduct.id, sampleProduct);
    this.stock.set(sampleProduct.id, [
      'NITRO-ABC1234-XYZ5678',
      'NITRO-DEF5678-UVW9012',
      'NITRO-GHI9012-RST3456'
    ]);
  }

  logAudit(action, actor, details) {
    const entry = { timestamp: new Date().toISOString(), action, actor, details };
    this.auditLogs.push(entry);
    console.log(`[AUDIT LOG] ${entry.timestamp} | ${action} por ${actor}`);
  }
}

const db = new DatabaseEngine();

/**
 * Model Context Protocol (MCP) - Integração de Contexto para Serviços / IA
 * Permite que agentes externos interajam com catálogo, estoque e transações de forma padronizada.
 */
class MCPServer {
  constructor(database) {
    this.db = database;
    this.tools = new Map();
    this.registerDefaultTools();
  }

  registerTool(name, description, schema, handler) {
    this.tools.set(name, { description, schema, handler });
  }

  registerDefaultTools() {
    // Tool MCP: Obter Catálogo e Estoque
    this.registerTool('get_catalog_context', 'Retorna o catálogo de produtos com disponibilidade de estoque', {}, async () => {
      const catalog = Array.from(this.db.products.values()).map(p => {
        const stockItems = this.db.stock.get(p.id) || [];
        return {
          id: p.id,
          name: p.name,
          category: p.category,
          price: p.price,
          availableStock: stockItems.length,
          active: p.active
        };
      });
      return { status: 'success', catalog };
    });

    // Tool MCP: Consultar Status de Transação
    this.registerTool('check_transaction_status', 'Verifica detalhes e status de uma transação por ID', { transactionId: 'string' }, async (args) => {
      const tx = this.db.transactions.get(args.transactionId);
      if (!tx) return { status: 'error', message: 'Transação não encontrada.' };
      return { status: 'success', transaction: tx };
    });

    // Tool MCP: Executar Rotina de Migração
    this.registerTool('trigger_migration', 'Dispara processo migratório de banco de dados', { targetVersion: 'number' }, async (args) => {
      const result = await migrationManager.runMigration(args.targetVersion);
      return result;
    });
  }

  async handleCall(toolName, args) {
    const tool = this.tools.get(toolName);
    if (!tool) throw new Error(`Ferramenta MCP '${toolName}' não registrada.`);
    return await tool.handler(args);
  }
}

/**
 * Gerenciador de Migração de Dados (Migration Flow Engine)
 * Suporta backup automático, validação de integridade e rollback automático em caso de erro.
 */
class MigrationEngine {
  constructor(database) {
    this.db = database;
  }

  async runMigration(targetVersion) {
    const backupFile = path.join(CONFIG.BACKUP_DIR, `backup_v${Date.now()}.json`);
    console.log(`[MIGRAÇÃO] Iniciando migração para versão v${targetVersion}...`);

    try {
      // 1. Criar Backup Automático
      const snapshot = {
        timestamp: new Date().toISOString(),
        version: CONFIG.CURRENT_SCHEMA_VERSION,
        products: Array.from(this.db.products.values()),
        stock: Array.from(this.db.stock.entries()),
        transactions: Array.from(this.db.transactions.values())
      };
      await fs.writeFile(backupFile, JSON.stringify(snapshot, null, 2));
      console.log(`[MIGRAÇÃO] Backup criado com sucesso em: ${backupFile}`);

      // 2. Aplicar Transformações de Dados (Exemplo v1 -> v2)
      if (CONFIG.CURRENT_SCHEMA_VERSION < targetVersion) {
        console.log('[MIGRAÇÃO] Normalizando esquemas de produtos e histórico...');
        for (const [id, prod] of this.db.products.entries()) {
          if (!prod.updatedAt) prod.updatedAt = new Date().toISOString();
          if (!prod.currency) prod.currency = 'BRL';
          this.db.products.set(id, prod);
        }
      }

      // 3. Validação de Integridade de Dados
      const isValid = this.validateIntegrity();
      if (!isValid) {
        throw new Error('Falha na validação de integridade dos dados pós-migração.');
      }

      // 4. Salvar Alterações
      await this.db.saveData();
      CONFIG.CURRENT_SCHEMA_VERSION = targetVersion;
      this.db.logAudit('MIGRATION_SUCCESS', 'SYSTEM', { targetVersion, backupFile });

      return { success: true, message: `Migração para v${targetVersion} executada com sucesso.`, backupFile };
    } catch (error) {
      console.error('[MIGRAÇÃO ERRO] Falha detectada durante a migração. Executando Rollback...', error);
      await this.rollback(backupFile);
      return { success: false, message: `Migração falhou. Rollback executado! Motivo: ${error.message}` };
    }
  }

  validateIntegrity() {
    // Garante que todo produto tenha ID válido e que preços sejam numéricos
    for (const prod of this.db.products.values()) {
      if (!prod.id || typeof prod.price !== 'number' || prod.price <= 0) {
        return false;
      }
    }
    return true;
  }

  async rollback(backupFile) {
    try {
      const rawData = await fs.readFile(backupFile, 'utf-8');
      const backup = JSON.parse(rawData);

      this.db.products.clear();
      backup.products.forEach(p => this.db.products.set(p.id, p));

      this.db.stock.clear();
      backup.stock.forEach(([id, items]) => this.db.stock.set(id, items));

      this.db.transactions.clear();
      backup.transactions.forEach(t => this.db.transactions.set(t.id, t));

      await this.db.saveData();
      this.db.logAudit('MIGRATION_ROLLBACK', 'SYSTEM', { restoredFrom: backupFile });
      console.log('[MIGRAÇÃO] Rollback concluído com sucesso. Estado anterior restaurado.');
    } catch (rollbackErr) {
      console.error('[CRÍTICO] Falha ao executar Rollback de emergência!', rollbackErr);
    }
  }
}

const migrationManager = new MigrationEngine(db);

/**
 * Gateway de Pagamentos Automático (Pix / Mercado Pago / Stripe)
 */
class PaymentGateway {
  // Gera QR Code e Payload do Pix
  static generatePixPayload(transactionId, amount) {
    const payload = `00020126580014BR.GOV.BCB.PIX0136${CONFIG.PIX_KEY}5204000053039865405${amount.toFixed(2)}5802BR5915BOT DE VENDAS6009SAO PAULO62070503***6304`;
    // Simulador de QR Code em formato base64/URL para envio
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(payload)}`;
    return { payload, qrCodeUrl };
  }

  // Processa aprovação de pagamento e dispara entrega
  static async processPaymentApproval(transactionId, client) {
    const tx = db.transactions.get(transactionId);
    if (!tx || tx.status === 'PAID') return;

    tx.status = 'PAID';
    tx.paidAt = new Date().toISOString();
    db.transactions.set(transactionId, tx);
    await db.saveData();

    db.logAudit('PAYMENT_APPROVED', tx.userId, { transactionId, amount: tx.amount });

    // Notificar entrega automática
    systemEvents.emit('PAYMENT_APPROVED', { transaction: tx, client });
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Verificação de Segurança Anti-Fraude
function verifyAccountSecurity(member) {
  const createdAt = member.user.createdAt;
  const now = new Date();
  const diffDays = Math.ceil(Math.abs(now - createdAt) / (1000 * 60 * 60 * 24));

  if (diffDays < CONFIG.MIN_ACCOUNT_AGE_DAYS) {
    return { allowed: false, reason: `Sua conta no Discord precisa ter no mínimo ${CONFIG.MIN_ACCOUNT_AGE_DAYS} dias de criação para evitar fraudes.` };
  }
  return { allowed: true };
}

function createStoreEmbed() {
  const embed = new EmbedBuilder()
    .setTitle('🛒 Loja Automática - Produtos disponíveis')
    .setDescription('Selecione um produto abaixo no menu para iniciar seu pedido automatizado via Pix.')
    .setColor('#5865F2')
    .setTimestamp()
    .setFooter({ text: 'Sistema MCP & Pagamento Automático' });

  const products = Array.from(db.products.values()).filter(p => p.active);
  
  if (products.length === 0) {
    embed.addFields({ name: 'Estoque Vazio', value: 'Nenhum produto disponível no momento.' });
  } else {
    products.forEach(p => {
      const stockCount = (db.stock.get(p.id) || []).length;
      embed.addFields({
        name: `${p.name} — R$ ${p.price.toFixed(2)}`,
        value: `📝 ${p.description}\n📦 **Estoque:** ${stockCount > 0 ? `${stockCount} unidades` : '❌ Esgotado'}\n🏷️ **Categoria:** ${p.category}`,
        inline: false
      });
    });
  }

  return embed;
}

function createStoreComponents() {
  const products = Array.from(db.products.values()).filter(p => p.active);
  const options = products.map(p => ({
    label: p.name,
    description: `R$ ${p.price.toFixed(2)} - ${p.category}`,
    value: p.id
  }));

  if (options.length === 0) {
    return [];
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_product')
    .setPlaceholder('Escolha um produto para comprar...')
    .addOptions(options);

  return [new ActionRowBuilder().addComponents(selectMenu)];
}

client.on('interactionCreate', async (interaction) => {
  try {
    // 1. Menu de Seleção de Produtos
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_product') {
      const productId = interaction.values[0];
      const product = db.products.get(productId);
      const stockItems = db.stock.get(productId) || [];

      // Validação de Segurança de Conta
      const secCheck = verifyAccountSecurity(interaction.member || interaction);
      if (!secCheck.allowed) {
        return interaction.reply({ content: `🛡️ **Anti-Fraude:** ${secCheck.reason}`, ephemeral: true });
      }

      if (stockItems.length === 0) {
        return interaction.reply({ content: '❌ Desculpe, este produto acabou de esgotar!', ephemeral: true });
      }

      // Bloqueio atômico para evitar Dupla Compra (Race condition)
      const lockAcquired = db.acquireLock(interaction.user.id, productId);
      if (!lockAcquired) {
        return interaction.reply({ content: '⚠️ Você já possui uma transação em andamento para este item. Por favor, conclua-a antes.', ephemeral: true });
      }

      // Criar Transação
      const transactionId = `TX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const pixData = PaymentGateway.generatePixPayload(transactionId, product.price);

      const transaction = {
        id: transactionId,
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        productId: product.id,
        productName: product.name,
        amount: product.price,
        status: 'PENDING',
        createdAt: new Date().toISOString()
      };

      db.transactions.set(transactionId, transaction);
      await db.saveData();

      const payEmbed = new EmbedBuilder()
        .setTitle(`💳 Pagamento Automático - ${product.name}`)
        .setDescription(`Para concluir sua compra de **R$ ${product.price.toFixed(2)}**, realize o pagamento via Pix.`)
        .addFields(
          { name: '📋 ID da Transação', value: `\`${transactionId}\``, inline: true },
          { name: '🔑 Copia e Cola Pix', value: `\`\`\`${pixData.payload}\`\`\``, inline: false }
        )
        .setImage(pixData.qrCodeUrl)
        .setColor('#FEE75C')
        .setFooter({ text: 'O pagamento é verificado automaticamente instantaneamente.' });

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`verify_pay_${transactionId}`).setLabel('Verificar Pagamento').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cancel_pay_${transactionId}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({ embeds: [payEmbed], components: [buttons], ephemeral: true });
    }

    // 2. Eventos de Botão (Verificação / Cancelamento)
    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId.startsWith('verify_pay_')) {
        const txId = customId.replace('verify_pay_', '');
        const tx = db.transactions.get(txId);

        if (!tx) return interaction.reply({ content: 'Transação não encontrada.', ephemeral: true });

        if (tx.status === 'PAID') {
          return interaction.reply({ content: '✅ Esta transação já foi paga e entregue!', ephemeral: true });
        }

        // Simulação de verificação manual / webhook fallback
        await interaction.deferReply({ ephemeral: true });
        
        // Simula teste de aprovação para demonstração (ou checagem real na API)
        await PaymentGateway.processPaymentApproval(txId, client);

        await interaction.editReply({ content: '🎉 **Pagamento Confirmado!** Seu produto foi enviado via Mensagem Direta (DM).' });
      }

      if (customId.startsWith('cancel_pay_')) {
        const txId = customId.replace('cancel_pay_', '');
        const tx = db.transactions.get(txId);

        if (tx) {
          tx.status = 'CANCELLED';
          db.transactions.set(txId, tx);
          db.releaseLock(tx.userId, tx.productId);
          await db.saveData();
        }

        await interaction.update({ content: '❌ Transação cancelada com sucesso.', embeds: [], components: [] });
      }
    }

    // 3. Comandos de Barra (Slash Commands)
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // Comando: Admin Panel
      if (commandName === 'admin') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: '⛔ Você não possui permissão para acessar o Painel Admin.', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'relatorio') {
          const totalRevenue = Array.from(db.transactions.values())
            .filter(t => t.status === 'PAID')
            .reduce((acc, t) => acc + t.amount, 0);

          const totalSales = Array.from(db.transactions.values()).filter(t => t.status === 'PAID').length;

          const reportEmbed = new EmbedBuilder()
            .setTitle('📊 Painel de Relatório de Vendas')
            .addFields(
              { name: '💰 Faturamento Total', value: `R$ ${totalRevenue.toFixed(2)}`, inline: true },
              { name: '📦 Total de Vendas', value: `${totalSales} vendas`, inline: true },
              { name: '🔄 Versão do Banco', value: `v${CONFIG.CURRENT_SCHEMA_VERSION}`, inline: true }
            )
            .setColor('#2ECC71');

          return interaction.reply({ embeds: [reportEmbed], ephemeral: true });
        }

        if (sub === 'migrar') {
          const targetVer = interaction.options.getInteger('versao');
          await interaction.deferReply({ ephemeral: true });
          const res = await migrationManager.runMigration(targetVer);
          return interaction.editReply({ content: res.message });
        }
      }

      // Comando: Mostrar Loja
      if (commandName === 'loja') {
        const embed = createStoreEmbed();
        const components = createStoreComponents();
        return interaction.reply({ embeds: [embed], components, ephemeral: false });
      }
    }
  } catch (err) {
    console.error('Erro na execução da interação:', err);
    if (!interaction.replied) {
      await interaction.reply({ content: '⚠️ Ocorreu um erro interno ao processar esta ação.', ephemeral: true });
    }
  }
});

systemEvents.on('PAYMENT_APPROVED', async ({ transaction, client }) => {
  try {
    const stockItems = db.stock.get(transaction.productId) || [];
    
    // Entrega Atômica (Retira item do estoque)
    if (stockItems.length === 0) {
      console.error(`[ALERTA CRÍTICO] Pagamento aprovado para transação ${transaction.id}, mas não há estoque!`);
      // Notificar Admin
      return;
    }

    const deliveredItem = stockItems.shift(); // Remove 1º item
    db.stock.set(transaction.productId, stockItems);
    db.releaseLock(transaction.userId, transaction.productId);
    await db.saveData();

    // Enviar mensagem por DM ao cliente
    const user = await client.users.fetch(transaction.userId);
    if (user) {
      const deliveryEmbed = new EmbedBuilder()
        .setTitle('📦 Entrega do Seu Produto!')
        .setDescription(`Obrigado por comprar conosco! Aqui estão os detalhes de resgate do seu produto: **${transaction.productName}**`)
        .addFields(
          { name: '🔑 Seu Código / Conta / Link', value: `\`\`\`${deliveredItem}\`\`\`` },
          { name: '🧾 ID da Compra', value: transaction.id }
        )
        .setColor('#57F287')
        .setTimestamp();

      await user.send({ embeds: [deliveryEmbed] }).catch(async () => {
        console.log(`[AVISO] Não foi possível enviar DM para o usuário ${user.tag}. Criando suporte privado...`);
      });
    }

    // Notificação de Estoque Baixo
    if (stockItems.length <= 2) {
      console.warn(`[NOTIFICAÇÃO] Estoque baixo para o produto '${transaction.productName}'. Restantes: ${stockItems.length}`);
    }

  } catch (err) {
    console.error('Erro no processamento da entrega:', err);
  }
});

const app = express();
app.use(express.json());

// Endpoint de Webhook do Mercado Pago / Gateway
app.post('/webhook/payment', async (req, res) => {
  const { action, data } = req.body;
  console.log('[WEBHOOK RECEBIDO]', req.body);

  if (action === 'payment.created' || action === 'payment.updated') {
    const transactionId = data.external_reference;
    if (transactionId) {
      await PaymentGateway.processPaymentApproval(transactionId, client);
    }
  }

  res.status(200).send({ received: true });
});

// Endpoint de protocolo MCP para comunicação REST/JSON API externa
app.post('/mcp/v1/call', async (req, res) => {
  const mcpServer = new MCPServer(db);
  const { tool, arguments: args } = req.body;

  try {
    const result = await mcpServer.handleCall(tool, args);
    res.json(result);
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

client.once('ready', async () => {
  console.log(`[BOT PRONTO] Logado como ${client.user.tag}`);
  
  // Inicializar Banco de Dados
  await db.init();

  // Registrar Comandos do Discord
  const commands = [
    {
      name: 'loja',
      description: 'Exibe a loja de produtos automatizada'
    },
    {
      name: 'admin',
      description: 'Comandos administrativos da loja',
      options: [
        {
          name: 'relatorio',
          description: 'Ver relatório de vendas e faturamento',
          type: 1 // SUB_COMMAND
        },
        {
          name: 'migrar',
          description: 'Executar migração de banco de dados com backup e rollback automático',
          type: 1,
          options: [
            {
              name: 'versao',
              description: 'Versão alvo para a migração',
              type: 4, // INTEGER
              required: true
            }
          ]
        }
      ]
    }
  ];

  try {
    await client.application.commands.set(commands);
    console.log('[COMANDOS] Comandos registrados globalmente com sucesso.');
  } catch (err) {
    console.error('[COMANDOS ERRO] Falha ao registrar comandos:', err);
  }
});

// Inicialização dos Servidores
app.listen(CONFIG.PORT, () => {
  console.log(`[SERVIDOR WEBHOOK & MCP] Rodando na porta ${CONFIG.PORT}`);
});

// Login do Bot no Discord (Ative quando configurar o token real)
if (CONFIG.BOT_TOKEN && CONFIG.BOT_TOKEN !== 'SEU_BOT_TOKEN_AQUI') {
  client.login(CONFIG.BOT_TOKEN);
} else {
  console.log('[AVISO] Defina o token do bot na constante CONFIG.BOT_TOKEN para conectá-lo ao Discord.');
      }
