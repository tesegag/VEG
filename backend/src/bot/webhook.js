const { Telegraf } = require('telegraf');
const commands = require('./commands');
const logger = require('../utils/logger');

function createBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  // Log every update that reaches the bot. Deliberately does not log free text
  // (could be an admin PIN or a payment SMS) or contact payloads (phone numbers).
  bot.use(async (ctx, next) => {
    const started = Date.now();
    const text = ctx.message && ctx.message.text;
    logger.info('Bot update received', {
      type: ctx.updateType,
      from: ctx.from && ctx.from.id,
      command: text && text.startsWith('/') ? text.split(/\s/)[0] : undefined,
      callback: ctx.callbackQuery && ctx.callbackQuery.data,
      hasContact: !!(ctx.message && ctx.message.contact) || undefined
    });
    await next();
    logger.info('Bot update handled', { type: ctx.updateType, ms: Date.now() - started });
  });

  bot.start(commands.handleStart);
  bot.action('register', commands.handleRegisterButton);
  bot.on('contact', commands.handleContact);

  bot.action('play', commands.handlePlay);
  bot.action('balance', commands.handleBalance);
  bot.action('copy_code', commands.handleCopyCode);
  bot.action('deposit', commands.handleDepositButton);
  bot.action('withdraw', commands.handleWithdrawButton);
  bot.action('support', commands.handleSupport);
  bot.action('info', commands.handleInfo);

  bot.action('admin_panel', commands.handleAdminPanel);
  bot.action('admin_deposits', commands.handleAdminDeposits);
  bot.action('admin_withdrawals', commands.handleAdminWithdrawals);
  bot.action('admin_dashboard', commands.handleAdminDashboard);
  bot.action('admin_credit', commands.handleAdminCreditButton);

  bot.action(/^dep_approve_(.+)$/, (ctx) => commands.handleDepositDecision(ctx, 'approve', ctx.match[1]));
  bot.action(/^dep_decline_(.+)$/, (ctx) => commands.handleDepositDecision(ctx, 'decline', ctx.match[1]));
  bot.action(/^dep_reverse_(.+)$/, (ctx) => commands.handleDepositDecision(ctx, 'reverse', ctx.match[1]));
  bot.action(/^dep_finalize_(.+)$/, (ctx) => commands.handleDepositDecision(ctx, 'finalize', ctx.match[1]));
  bot.action(/^wd_approve_(.+)$/, (ctx) => commands.handleWithdrawDecision(ctx, 'approve', ctx.match[1]));
  bot.action(/^wd_decline_(.+)$/, (ctx) => commands.handleWithdrawDecision(ctx, 'decline', ctx.match[1]));

  bot.on('text', commands.routeTextMessage);

  bot.catch(async (err, ctx) => {
    logger.error('Telegraf error', { error: err.message, stack: err.stack, updateType: ctx.updateType });
    // Without this the user just sees the bot go silent (e.g. stuck at /start).
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Something went wrong. Please try again.');
      else if (ctx.chat) await ctx.reply('⚠️ Something went wrong. Please try again in a moment.');
    } catch (replyErr) {
      logger.warn('Could not send error notice to user', { error: replyErr.message });
    }
  });

  return bot;
}

module.exports = { createBot };
