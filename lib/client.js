window.__ModuleLoader__.load({
  id: '@ft/dsh-fft-paper-trading',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const h = React.createElement

    const ROUTE = '/api/ft-paper-trading'
    const PERIODS = [
      ['7d', '7 天'],
      ['30d', '30 天'],
      ['all', '全部'],
    ]
    // The futures account has no market page and no K-line: search lives inside
    // the ticket, so the wallet pages match the stock ones one for one.
    const FUTURES_TABS = ['trade', 'positions', 'orders', 'review']
    const FUTURES_TAB_LABEL = { trade: '交易', positions: '持仓', orders: '订单', review: '复盘' }

    /* ---------------------------------------------------------------- text --
       Pure formatting and vocabularies. Times are always zh-CN /
       Asia/Shanghai; numbers that are not finite render as `—` instead of a
       blank or `NaN`, and backend codes never leak into the main copy. */

    const TZ = 'Asia/Shanghai'
    // sv-SE formats as YYYY-MM-DD, which matches the trade-date column and the
    // header; zh-CN would print 2026/10/22 slashes instead.
    const dateTimeFormat = new Intl.DateTimeFormat('sv-SE', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    const timeFormat = new Intl.DateTimeFormat('zh-CN', {
      timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })

    const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)
    // Amounts read as money: group thousands and always show two decimals.
    const amountFormat = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const money = value => isFiniteNumber(value) ? amountFormat.format(value) : '—'
    const cents = value => isFiniteNumber(value) ? amountFormat.format(value / 100) : '—'
    const pct = value => isFiniteNumber(value) ? `${(value * 100).toFixed(2)}%` : '—'
    const signed = value => {
      if (!isFiniteNumber(value)) return '—'
      // Zero is neither a gain nor a loss: no misleading "+0.00".
      return `${value > 0 ? '+' : ''}${amountFormat.format(value)}`
    }
    const tone = value => !isFiniteNumber(value) ? '' : value > 0 ? 'pt-up' : value < 0 ? 'pt-down' : ''
    const count = value => isFiniteNumber(value) ? String(Math.round(value)) : '—'
    const toDate = value => {
      if (value === undefined || value === null || value === '') return null
      const time = Date.parse(value)
      return Number.isNaN(time) ? null : new Date(time)
    }
    const dateTime = value => {
      const date = toDate(value)
      return date === null ? '—' : dateTimeFormat.format(date)
    }
    const clockTime = value => {
      const date = toDate(value)
      return date === null ? '—' : timeFormat.format(date)
    }
    const dateFormat = new Intl.DateTimeFormat('sv-SE', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    })
    const shanghaiToday = () => dateFormat.format(new Date())
    /** After the close the ledger rolls to the next trading day; say so. */
    const tradeDateText = value => {
      if (!value) return '—'
      return value > shanghaiToday() ? `下一交易日 ${value}` : value
    }
    /** Display form is always the bare 6-digit code; the API accepts either. */
    const bareSymbol = value => String(value ?? '').trim().toUpperCase().split('.')[0]
    const halfWidthDigits = value => String(value ?? '')
      .replace(/[０-９]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
    // A-share codes are digits; accepting letters turned a pasted SH600519 into
    // the six-character SH6005. Map full-width digits (Chinese IME) then keep
    // only digits so prefixes/suffixes vanish.
    const symbolInput = value => halfWidthDigits(value).replace(/[^0-9]/g, '').slice(0, 6)
    const budgetInput = value => halfWidthDigits(value).replace(/[,，\s]/g, '')
    const symbolText = quote => [bareSymbol(quote?.symbol), quote?.name].filter(text => text).join(' ')
    /** Quote origin in human terms; the raw interface name is too technical. */
    const quoteSourceText = quote => {
      if (!quote || !quote.source) return 'FTShare'
      if (quote.source === 'manual') return '参考价'
      if (quote.source === 'daily-bar') return '日K'
      return 'FTShare'
    }
    /** Watchlist entries may carry an exchange suffix; compare on the bare code. */
    const watched = (watchlist, symbol) => watchlist.some(item => bareSymbol(item) === bareSymbol(symbol))

    /**
     * Why the ticket cannot be previewed yet. An incomplete draft would
     * otherwise come back priced at 0.00 — a card that looks like a real
     * order for nothing — so the panel asks for the missing field instead.
     */
    const previewBlockReason = draft => {
      if (String(draft.symbol ?? '').trim().length < 6) return '输入 6 位代码后自动计算'
      const qty = Number(draft.qty)
      if (!Number.isInteger(qty) || qty <= 0) return '填写数量后自动计算'
      if (draft.type === 'limit' && !(Number(draft.limitPrice) > 0)) return '填写限价后自动计算'
      return ''
    }

    const STATUS_TEXT = {
      queued: '排队',
      pending: '挂单',
      partially_filled: '部分成交',
      filled: '成交',
      canceled: '已撤',
      rejected: '拒绝',
      expired: '过期',
    }
    /** Why the ticket is limited outside continuous trading. */
    const sessionNote = session => {
      if (!session || session.canMatch) return ''
      if (session.phase === 'auction_close') return '（收盘竞价暂不支持下单）'
      return '（仅可预埋限价单）'
    }
    const PHASE_TEXT = {
      pre_open: '集合竞价',
      continuous_am: '上午连续竞价',
      lunch: '午休',
      continuous_pm: '下午连续竞价',
      auction_close: '收盘竞价',
      closed: '已收盘',
    }
    const CASH_TYPE_TEXT = {
      open: '初始资金',
      reset: '重置',
      buy: '买入',
      sell: '卖出',
      fee: '费用',
    }
    const CANCEL_REASON_TEXT = {
      user: '手动撤单',
      expired: '当日有效期满',
      insufficient_cash: '资金不足',
      insufficient_position: '可卖不足',
      margin_unavailable: '可用资金不足',
      insufficient_margin: '保证金不足',
      risk: '强制平仓',
      expiry: '到期平仓',
    }
    /** Basket row states; the raw codes never reach the table. */
    const BASKET_STATUS_TEXT = {
      ok: '可买',
      zero_lot: '不足 1 手',
      no_quote: '无行情',
      suspended: '停牌',
    }
    const FUTURES_PHASE_TEXT = {
      pre_open: '待开盘',
      trading: '交易中',
      lunch: '休市',
      closed: '已收盘',
    }
    const FUTURES_STATUS_TEXT = {
      pending: '挂单',
      filled: '成交',
      canceled: '已撤',
      rejected: '拒绝',
      expired: '过期',
    }
    /** Position direction; orders use the open/close form below. */
    const FUTURES_SIDE_TEXT = { long: '多', short: '空' }
    const FUTURES_DIRECTION_TEXT = {
      long_open: '开多',
      short_open: '开空',
      long_close: '平多',
      short_close: '平空',
    }
    const directionText = (side, offset) => FUTURES_DIRECTION_TEXT[`${side}_${offset}`] ?? '—'
    const orderTypeText = type => type === 'limit' ? '限价' : '市价'
    const ERROR_TEXT = {
      ACCOUNT_BLOCKED: '账户已锁定，请先重置或导出账本',
      INVALID_ARGUMENT: '参数不合法',
      INVALID_SYMBOL: '证券代码不合法',
      INVALID_QTY: '数量不合法',
      INVALID_LOT: '买入数量必须是 100 股的整数倍',
      INSUFFICIENT_CASH: '可用资金不足',
      INSUFFICIENT_POSITION: '持仓不足',
      T1_LOCKED: '当日买入的股份不可卖出（T+1）',
      MAX_NOTIONAL: '超过单笔金额上限',
      ORDER_NOT_FOUND: '订单不存在',
      ORDER_NOT_PENDING: '订单不是挂单状态',
      QUOTE_UNAVAILABLE: '没有可用行情',
      QUOTE_STALE: '行情已过期',
      SESSION_CLOSED: '当前时段不接受委托',
      AUCTION_ONLY: '当前时段不接受市价单',
      PRICE_LIMIT: '价格超出涨跌停范围',
      SUSPENDED: '标的停牌',
      INSUFFICIENT_LIQUIDITY: '可成交量不足',
      INSUFFICIENT_MARGIN: '保证金不足',
      CONTRACT_NOT_FOUND: '合约不存在',
      CONTRACT_EXPIRED: '合约临近交割或已到期',
      NO_VOLUME: '当日无成交',
      LIMIT_UNAVAILABLE: '暂无涨跌停数据',
      MARGIN_UNAVAILABLE: '暂无保证金率数据',
      INTERNAL: '内部错误',
    }
    const CODE_PREFIX = /^([A-Z_]+):\s*(.*)$/
    /** `T1_LOCKED: 可卖数量不足（可卖 0 股）` → the Chinese detail only. */
    const reasonText = (reason, scope = 'stock') => {
      if (!reason) return ''
      const matched = CODE_PREFIX.exec(reason)
      if (matched) return matched[2] || ERROR_TEXT[matched[1]] || reason
      if (reason === 'insufficient_position') return scope === 'futures' ? '可平不足' : '可卖不足'
      return CANCEL_REASON_TEXT[reason] ?? reason
    }
    // The host message is already a readable Chinese sentence and carries
    // the specifics ("最多 20 只，本次 21 只"); the code label is only a fallback.
    const errorText = (code, message) => (typeof message === 'string' && message.trim() !== '')
      ? message
      : (ERROR_TEXT[code] ?? '操作失败')
    const errorOf = cause => ({
      text: cause && cause.message ? cause.message : '操作失败',
      detail: cause && cause.detail ? cause.detail : '',
    })

    async function rpc(endpoint, payload) {
      const response = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload: payload ?? {} }),
      })
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok || body === null || body.ok !== true) {
        const failureBody = body && body.error ? body.error : { code: 'INTERNAL', message: `HTTP ${response.status}` }
        const failure = new Error(errorText(failureBody.code, failureBody.message))
        failure.code = failureBody.code
        failure.detail = `${failureBody.code}: ${failureBody.message}`
        throw failure
      }
      return body.value
    }

    const CSS = `
      /* Accent comes from the shared FT brand layer; the local aliases keep the
         fallback in one place, so the panel still matches when fft-settings is
         absent. The brand layer publishes a value per palette. */
      .pt-root { --pt-accent:var(--ft-accent-warm,light-dark(#cf5623, #ff8352));
        --pt-accent-hover:var(--ft-accent-warm-hover,light-dark(#b8481b, #ff9a72));
        --pt-accent-ink:var(--ft-accent-warm-ink,light-dark(#ffffff, #1a120e));
        --pt-accent-soft:var(--ft-accent-warm-soft,light-dark(#fbeee8, #2b1d16));
        /* The page surface and its content use the whole centre column; the
           K-line rail takes a fixed share on wide screens instead of a
           centred reader column. */
        flex:1 1 auto; min-width:0; min-height:0; height:100%; box-sizing:border-box;
        overflow:auto; scrollbar-gutter:stable; width:100%; align-self:stretch;
        background:var(--dsw-alias-bg-base, #ffffff); color:var(--dsw-alias-label-primary, #171b22);
        font-size:var(--dsh-content-font-size-secondary, 13px); line-height:1.5; container:paper-panel / inline-size; }
      .pt-inner { display:flex; flex-direction:column; gap:10px; box-sizing:border-box;
        width:100%; margin:0 auto;
        padding:calc(28px + var(--dsh-frame-top-clearance, 0px)) clamp(16px, 2.2vw, 40px) 24px; }
      .pt-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;
        padding-bottom:8px; border-bottom:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.12)); }
      .pt-title { font-size:16px; font-weight:500; letter-spacing:-.01em; margin:0; }
      .pt-sub { color:var(--dsw-alias-label-secondary, #49525f); font-size:12px; margin-top:2px; }
      .pt-stats { display:flex; border:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.12));
        border-radius:var(--dsw-radius-sm, 8px); background:var(--dsw-alias-bg-layer-2, #f7f8fa); overflow:hidden; }
      .pt-stat { flex:1 1 0; min-width:0; padding:7px 10px;
        border-right:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.10)); }
      .pt-stat:last-child { border-right:0; }
      .pt-stat-label { font-size:11px; letter-spacing:.04em; color:var(--dsw-alias-label-secondary, #49525f); }
      .pt-stat-value { font-size:16px; font-weight:500; margin-top:1px; font-variant-numeric:tabular-nums;
        font-family:"SF Mono", "JetBrains Mono", Menlo, monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .pt-up { color:var(--dsw-alias-state-error-primary, #b23b2e); }
      .pt-down { color:var(--dsw-alias-state-success-primary, #2f6b47); }
      .pt-tabs { display:flex; gap:4px; border:0; padding:0; margin-top:1px; }
      .pt-tab { border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.14));
        background:var(--dsw-alias-bg-base, #fff); padding:4px 10px; cursor:pointer;
        color:var(--dsw-alias-label-secondary, #49525f); border-radius:var(--dsw-radius-xs, 4px);
        font-size:12px; font-family:inherit; }
      .pt-tab:hover { background:var(--dsw-alias-interactive-bg-hover, #eef1f5); }
      .pt-tab[data-active="true"] { color:var(--dsw-alias-label-primary, #171b22);
        border-color:var(--pt-accent);
        background:var(--pt-accent-soft); font-weight:500; }
      .pt-btn { border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.18));
        background:var(--dsw-alias-bg-layer-1, #fff); color:inherit; border-radius:var(--dsw-radius-xs, 4px);
        padding:5px 9px; cursor:pointer; font-size:12px; font-family:inherit; }
      .pt-btn:hover { border-color:var(--pt-accent);
        background:var(--dsw-alias-interactive-bg-hover, #eef1f5); }
      .pt-btn[data-active="true"] { border-color:var(--pt-accent); background:var(--pt-accent-soft);
        color:var(--dsw-alias-label-primary, #171b22); font-weight:500; }
      .pt-btn[disabled] { opacity:.5; cursor:default; }
      .pt-btn-primary { background:var(--pt-accent);
        border-color:var(--pt-accent);
        color:var(--pt-accent-ink); font-weight:500; }
      .pt-btn-primary:hover { background:var(--pt-accent-hover); border-color:var(--pt-accent-hover); }
      .pt-btn-danger { color:var(--dsw-alias-state-error-primary, #a33b2a); }
      .pt-row { display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; }
      .pt-field { display:flex; flex-direction:column; gap:3px; min-width:0; }
      .pt-field span { font-size:11px; color:var(--dsw-alias-label-secondary, #49525f); }
      .pt-input { width:100%; min-width:0; box-sizing:border-box; padding:5px 7px; font-size:12px;
        border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.18)); border-radius:var(--dsw-radius-xs, 4px);
        background:var(--dsw-alias-bg-base, #fff); color:inherit; font-family:inherit; }
      .pt-seg { display:flex; box-sizing:border-box; border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.18));
        border-radius:var(--dsw-radius-xs, 4px); overflow:hidden; }
      .pt-seg button { border:0; background:none; padding:5px 9px; cursor:pointer; font-size:12px;
        color:inherit; font-family:inherit; }
      .pt-seg button[data-active="true"] { background:var(--pt-accent);
        color:var(--pt-accent-ink); font-weight:500; }
      .pt-quote { display:flex; gap:12px; flex-wrap:wrap; padding:7px 9px; border-radius:var(--dsw-radius-sm, 8px);
        background:var(--dsw-alias-bg-layer-2, #f7f8fa); font-variant-numeric:tabular-nums;
        border:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.08)); }
      .pt-preview { display:flex; flex-direction:column; gap:1px; }
      .pt-preview div { display:flex; justify-content:space-between; gap:12px; padding:2px 0; }
      .pt-preview .pt-warn { color:var(--dsw-alias-state-warn-primary, #8a6410); display:block; }
      .pt-receipt { margin-top:8px; padding:7px 9px; font-size:12px; border-radius:var(--dsw-radius-xs, 4px);
        border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.16));
        background:var(--dsw-alias-bg-layer-2, #f7f8fa); font-variant-numeric:tabular-nums; }
      .pt-receipt[data-state="filled"] { border-color:var(--dsw-alias-state-success-primary, #2f6b47); }
      .pt-receipt[data-state="rejected"] { color:var(--dsw-alias-state-error-primary, #a33b2a);
        border-color:var(--dsw-alias-state-error-primary, #a33b2a); }
      .pt-card { border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.12));
        border-radius:var(--dsw-radius-sm, 8px); background:var(--dsw-alias-bg-layer-1, #fff); padding:10px; min-width:0; }
      .pt-card-title { font-size:11px; font-weight:500; letter-spacing:.04em;
        color:var(--dsw-alias-label-secondary, #49525f); margin-bottom:8px; }
      /* Main workspace: the K-line rail sets the row height, so the left column
         stretches to the same bottom edge instead of ending mid-air. */
      .pt-workspace { display:grid; grid-template-columns:minmax(0, 1fr) clamp(380px, 38%, 760px);
        gap:10px; align-items:stretch; min-width:0; }
      .pt-main { display:flex; flex-direction:column; gap:10px; min-width:0; min-height:0;
        container:paper-main / inline-size; }
      .pt-tab-body { display:flex; flex-direction:column; gap:10px; flex:1 1 auto; min-height:0; }
      .pt-kline-rail { position:sticky; top:calc(12px + var(--dsh-frame-top-clearance, 0px)); align-self:start; min-width:0; }
      .pt-kline-card { display:flex; flex-direction:column; min-width:0; }
      .pt-kline-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; flex-wrap:wrap; margin-bottom:8px; }
      .pt-kline-title { min-width:0; }
      .pt-kline-body { height:clamp(420px, calc(100vh - 250px), 720px); min-height:0; overflow:hidden;
        border:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.08)); border-radius:var(--dsw-radius-sm, 8px);
        background:var(--dsw-alias-bg-layer-2, #f7f8fa); }
      .pt-kline-slot, .pt-kline-body > div { width:100%; height:100%; min-height:0; }
      .pt-kline-body .pt-chart { height:100%; }
      .pt-kline-hint { margin-top:6px; font-size:11px; }
      /* Trade ticket: one form grid keeps every field and control on the same
         columns; the fee preview sits in the same card, not in a loose sibling. */
      .pt-trade { display:flex; flex-direction:column; gap:10px; flex:1 1 auto; min-height:0; }
      .pt-ticket-card { display:flex; flex-direction:column; gap:12px; flex:0 0 auto; }
      .pt-ticket { display:grid; grid-template-columns:minmax(0, 1fr) minmax(230px, 300px); gap:18px; align-items:start; }
      .pt-ticket-form { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr));
        gap:10px 12px; align-items:start; min-width:0; }
      .pt-span-2 { grid-column:1 / -1; }
      .pt-field .pt-seg { width:100%; }
      .pt-field .pt-seg button { flex:1 1 0; }
      .pt-ticket-form .pt-input { height:30px; }
      .pt-preview-pane { min-width:0; border-left:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.10));
        padding-left:18px; }
      .pt-ticket-foot { display:flex; flex-direction:column; gap:8px;
        border-top:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.10)); padding-top:10px; }
      .pt-ticket-submit { width:100%; justify-content:center; padding:8px 12px; font-size:13px; }
      .pt-ticket-meta { display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; }
      /* Always-present book under the ticket: holdings or pending orders, so the
         left column always closes at the K-line's bottom edge. */
      .pt-trade-book { display:flex; flex-direction:column; gap:8px; flex:1 1 auto; min-height:150px; }
      .pt-book-head { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
      .pt-book-scroll { flex:1 1 auto; min-height:0; overflow:auto; }
      .pt-book-empty { display:flex; align-items:center; justify-content:center; min-height:84px; }
      .pt-table-wrap { overflow-x:auto; min-width:0; }
      .pt-note-cell { display:inline-block; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom; }
      .pt-table { width:100%; border-collapse:collapse; font-size:12px; min-width:0; }
      .pt-table th { text-align:left; font-weight:500; color:var(--dsw-alias-label-secondary, #49525f);
        font-size:11px; letter-spacing:.04em; padding:6px 7px;
        border-bottom:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.12)); white-space:nowrap; }
      .pt-table td { padding:6px 7px; border-bottom:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.08));
        font-variant-numeric:tabular-nums; white-space:nowrap; height:30px; }
      .pt-empty { color:var(--dsw-alias-label-secondary, #49525f); padding:12px 4px; }
      .pt-error { color:var(--dsw-alias-state-error-primary, #a33b2a);
        background:color-mix(in srgb, var(--dsw-alias-state-error-primary, #a33b2a) 10%, transparent);
        border-radius:var(--dsw-radius-xs, 4px); padding:7px 9px; }
      .pt-note { color:var(--dsw-alias-label-secondary, #49525f); font-size:12px; }
      .pt-blocked { color:var(--dsw-alias-state-error-primary, #a33b2a);
        border:0.5px solid var(--dsw-alias-state-error-primary, #a33b2a);
        border-radius:var(--dsw-radius-xs, 4px); padding:7px 9px;
        display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
      .pt-blocked-text { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1 1 320px; }
      .pt-blocked-detail { font-size:11px; line-height:1.4; font-variant-numeric:tabular-nums;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .pt-blocked-hint { font-size:11px; line-height:1.4; color:var(--dsw-alias-label-secondary, #49525f); }
      .pt-chart { width:100%; height:120px; display:block; }
      .pt-chart-wrap { border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.12));
        border-radius:var(--dsw-radius-sm, 8px); padding:8px; }
      /* Futures: the element rail is narrower than the K-line rail, and the
         risk figure turns amber before the account reaches the liquidation line. */
      .pt-workspace-futures { grid-template-columns:minmax(0, 1fr) clamp(260px, 30%, 400px); }
      .pt-futures-rail { position:sticky; top:calc(12px + var(--dsh-frame-top-clearance, 0px)); align-self:start; min-width:0; }
      .pt-risk-high { color:var(--dsw-alias-state-warn-primary, #8a6410); }
      /* Breakpoints follow the panel's own width, not the window's: the centre
         column also yields to the sidebar and the right pane, so a wide screen
         can still leave a narrow trading surface. */
      @container paper-main (max-width: 640px) {
        .pt-ticket { grid-template-columns:minmax(0, 1fr); }
        .pt-preview-pane { border-left:0; border-top:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.10));
          padding-left:0; padding-top:12px; }
      }
      @container paper-main (max-width: 460px) { .pt-ticket-form { grid-template-columns:minmax(0, 1fr); } }
      @container paper-panel (max-width: 1100px) {
        .pt-workspace, .pt-workspace-futures { grid-template-columns:minmax(0, 1fr); }
        .pt-kline-rail { position:static; order:-1; }
        .pt-futures-rail { position:static; order:-1; }
        .pt-kline-body { height:360px; }
      }
      @container paper-panel (max-width: 760px) {
        .pt-stats { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
        .pt-stat:nth-child(2n) { border-right:0; }
        .pt-stat:nth-child(-n+2) { border-bottom:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.10)); }
        .pt-chart { height:96px; }
      }
      @container paper-panel (max-width: 520px) {
        .pt-inner { padding-left:12px; padding-right:12px; padding-bottom:20px; }
        .pt-stat-value { font-size:15px; }
        .pt-tabs { overflow-x:auto; }
        .pt-tab { flex:0 0 auto; }
      }
      .pt-root button:focus-visible, .pt-root input:focus-visible,
      .pt-root .pt-seg button:focus-visible, .pt-root .pt-tab:focus-visible {
        outline:2px solid var(--pt-accent); outline-offset:2px; }
    `

    /* ------------------------------------------------------------ atoms --- */

    function Field({ label, children, span = false }) {
      return h('label', { className: span ? 'pt-field pt-span-2' : 'pt-field' }, h('span', null, label), children)
    }

    /** Wide tables scroll inside their own box instead of the page. */
    function Table({ children }) {
      return h('div', { className: 'pt-table-wrap' }, h('table', { className: 'pt-table' }, children))
    }

    /** A label/value row inside the `.pt-preview` cards. */
    const previewRow = (label, value, tone) => h('div', null, h('span', null, label), h('span', { className: tone || undefined }, value))

    /** One cell of the compact `.pt-stats` strip. */
    const statCell = (label, value, tone) => h('div', { className: 'pt-stat' },
      h('div', { className: 'pt-stat-label' }, label),
      h('div', { className: tone ? `pt-stat-value ${tone}` : 'pt-stat-value' }, value),
    )

    function DebouncedNumber({ value, onChange, placeholder, min, step }) {
      return h('input', {
        className: 'pt-input',
        type: 'number',
        value: value === '' ? '' : value,
        placeholder,
        min,
        step,
        onChange: event => onChange(event.target.value),
      })
    }

    /** Top-level account switch: the stock and futures ledgers are independent. */
    function AccountSwitch({ mode, onChange }) {
      return h('div', { className: 'pt-seg', role: 'group', 'aria-label': '账户' },
        [['stock', '股票'], ['futures', '期货']].map(([key, label]) =>
          h('button', { key, 'data-active': mode === key, onClick: () => onChange(key) }, label),
        ),
      )
    }

    function EquityChart({ points }) {
      // One snapshot cannot be a curve: show the value and say why it is flat.
      if (points.length < 2) {
        const only = points.length === 1 ? `最新权益 ${money(points[0].equity)} · ` : ''
        return h('div', { className: 'pt-empty' }, `${only}至少两个交易日后才有权益曲线`)
      }
      const width = 620
      const height = 160
      const values = points.map(point => point.equity)
      const min = Math.min(...values)
      const max = Math.max(...values)
      const span = max - min || Math.max(1, max * 0.02)
      const x = index => points.length === 1 ? 0 : (index / (points.length - 1)) * width
      const y = value => height - ((value - min) / span) * (height - 16) - 8
      const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.equity).toFixed(1)}`).join(' ')
      const area = `${line} L${width},${height} L0,${height} Z`
      return h('svg', { className: 'pt-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': '权益曲线' },
        h('path', { d: area, fill: 'var(--pt-accent)', fillOpacity: 0.10 }),
        h('path', { d: line, fill: 'none', stroke: 'var(--pt-accent)', strokeWidth: 1.6 }),
        h('text', { x: 4, y: 12, fontSize: 9, fill: 'var(--dsw-alias-label-secondary, #6b7480)' }, max.toFixed(0)),
        h('text', { x: 4, y: height - 2, fontSize: 9, fill: 'var(--dsw-alias-label-secondary, #6b7480)' }, min.toFixed(0)),
      )
    }

    /** Candlestick/line chart from daily or minute bars; no external chart lib. */
    function PriceChart({ bars, interval }) {
      if (!Array.isArray(bars) || bars.length === 0) return h('div', { className: 'pt-empty' }, '暂无 K 线数据')
      const width = 640
      const height = 200
      const min = Math.min(...bars.map(bar => bar.low ?? bar.close))
      const max = Math.max(...bars.map(bar => bar.high ?? bar.close))
      const span = max - min || Math.max(1, max * 0.02)
      const x = index => bars.length === 1 ? width / 2 : (index / (bars.length - 1)) * (width - 20) + 10
      const y = value => height - ((value - min) / span) * (height - 24) - 12
      const line = bars.map((bar, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(bar.close).toFixed(1)}`).join(' ')
      return h('svg', { className: 'pt-chart pt-chart-fill', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': interval === 'minute' ? '分时图' : '日K线' },
        interval === 'minute'
          ? h('path', { d: line, fill: 'none', stroke: 'var(--pt-accent, #cf5623)', strokeWidth: 1.6 })
          : h('g', null, bars.map((bar, index) => {
            const up = bar.close >= bar.open
            const color = up ? 'var(--pt-rise, #f04462)' : 'var(--pt-fall, #00b578)'
            const top = y(Math.max(bar.open, bar.close))
            const bottom = y(Math.min(bar.open, bar.close))
            return h('g', { key: `${bar.time}-${index}` },
              h('line', { x1: x(index), x2: x(index), y1: y(bar.high), y2: y(bar.low), stroke: color, strokeWidth: 1 }),
              h('rect', { x: x(index) - 2.5, y: top, width: 5, height: Math.max(1, bottom - top), fill: color }),
            )
          })),
      )
    }

    /* --------------------------------------------------------- K-line ----- */

    /**
     * Always-visible K-line rail; dsh_kline fills the slot when installed.
     * The slot owns its own interval switch, so the built-in day/minute
     * buttons only exist for the fallback SVG (no dead controls).
     */
    function KlinePane({ renderSlot, symbol, quote, bars, error, interval, onInterval, onRefresh, onIdentity }) {
      const slot = typeof renderSlot === 'function'
        ? renderSlot('paperTrading.kline', { symbol, onIdentity })
        : null
      const hasSlot = slot !== null && slot !== undefined && slot !== false
        && !(Array.isArray(slot) && slot.length === 0)
      // A registered slot can still render an empty host (no data, failed
      // mount). Poll it briefly; if nothing shows up, fall back to the built-in
      // chart instead of leaving 35% of the panel blank.
      const [slotFailed, setSlotFailed] = useState(false)
      const [slotChecking, setSlotChecking] = useState(hasSlot)
      const [slotNonce, setSlotNonce] = useState(0)
      const slotRef = useRef(null)
      useEffect(() => {
        if (!hasSlot) return undefined
        setSlotFailed(false)
        setSlotChecking(true)
        let tries = 0
        const timer = setInterval(() => {
          tries += 1
          const host = slotRef.current
          // Only real drawing counts: dsh_kline shows a transient "加载中…"
          // text before its canvas mounts (and may never mount), so text alone
          // must not mark the slot as healthy.
          const painted = host !== null && host.querySelector('canvas, iframe, svg, table, video') !== null
          if (painted) { setSlotChecking(false); clearInterval(timer) }
          else if (tries >= 20) { setSlotFailed(true); setSlotChecking(false); clearInterval(timer) }
        }, 300)
        return () => clearInterval(timer)
      }, [hasSlot, symbol, slotNonce])
      const showFallback = !hasSlot || slotFailed
      return h('aside', { className: 'pt-kline-rail', 'aria-label': 'K线' },
        h('div', { className: 'pt-card pt-kline-card' },
          h('div', { className: 'pt-kline-head' },
            h('div', { className: 'pt-kline-title' },
              h('div', { className: 'pt-card-title', style: { margin: 0 } }, `${bareSymbol(symbol) || '—'} K线`),
              h('div', { className: 'pt-note' }, quote ? `${symbolText(quote)} · 现价 ${money(quote.last)}` : '等待行情'),
            ),
            showFallback ? h('div', { className: 'pt-row', style: { flexWrap: 'nowrap', alignItems: 'center' } },
              h('div', { className: 'pt-seg' },
                [['day', '日K'], ['minute', '分时']].map(([key, label]) =>
                  h('button', { key, 'data-active': interval === key, onClick: () => onInterval(key) }, label),
                ),
              ),
              h('button', { className: 'pt-btn', onClick: onRefresh }, '刷新'),
            ) : null,
          ),
          h('div', { className: 'pt-kline-body' },
            showFallback
              ? h(PriceChart, { bars, interval })
              : h('div', { className: 'pt-kline-slot', ref: slotRef, key: slotNonce }, slot),
          ),
          showFallback ? h('div', { className: 'pt-note pt-kline-hint' },
            slotFailed
              ? 'K 线视图未加载，当前为内置简图。'
              : error !== '' ? error : '安装或升级 dsh_kline 后显示完整 K 线；当前为内置简图。',
            slotFailed ? h('button', {
              className: 'pt-btn', style: { marginLeft: 8 },
              onClick: () => { setSlotFailed(false); setSlotNonce(value => value + 1) },
            }, '重试 K 线') : null,
          ) : slotChecking ? h('div', { className: 'pt-note pt-kline-hint' }, 'K 线加载中…') : null,
        ),
      )
    }

    /* ----------------------------------------------------------- tabs ----- */

    function TradeTab({
      account, form, setForm, quote, quoteError, preview, previewState, previewError, previewHint,
      busy, onSubmit, submitReason, receipt, positions, pending, onCancel, onSell,
    }) {
      // Default to whichever book has content; the toggle keeps both one click away.
      const [book, setBook] = useState(() => (positions.length === 0 && pending.length > 0 ? 'orders' : 'positions'))
      const maxBuy = preview ? count(preview.maxBuyQty) : '—'
      const priceLabel = form.type === 'limit' ? '限价' : '参考价（可选）'
      const quoteHint = quote
        ? null
        : form.symbol.trim().length < 6
          ? '输入 6 位代码后自动取行情'
          : previewState === 'loading'
            ? '取行情…'
            : form.type === 'limit' ? '未取到行情，可填限价' : '未取到行情，可填参考价'
      const emptyPreview = previewHint !== ''
        ? previewHint
        : previewState === 'loading' ? '计算中…' : previewError !== '' ? previewError : '计算中…'
      return h('div', { className: 'pt-trade' },
        h('div', { className: 'pt-card pt-ticket-card' },
          h('div', { className: 'pt-ticket' },
            h('div', { className: 'pt-ticket-form' },
              h(Field, { label: '代码' }, h('input', {
                className: 'pt-input', value: form.symbol, inputMode: 'numeric', maxLength: 9,
                placeholder: '600519',
                onChange: event => setForm(prev => ({ ...prev, symbol: symbolInput(event.target.value) })),
              })),
              h(Field, { label: '数量' }, h(DebouncedNumber, {
                value: form.qty, min: 0, step: 100, placeholder: '100',
                onChange: value => setForm(prev => ({ ...prev, qty: value })),
              })),
              h(Field, { label: '方向' }, h('div', { className: 'pt-seg' },
                [['buy', '买入'], ['sell', '卖出']].map(([key, label]) =>
                  h('button', { key, 'data-active': form.side === key, onClick: () => setForm(prev => ({ ...prev, side: key })) }, label),
                ),
              )),
              h(Field, { label: '类型' }, h('div', { className: 'pt-seg' },
                [['market', '市价'], ['limit', '限价']].map(([key, label]) =>
                  h('button', { key, 'data-active': form.type === key, onClick: () => setForm(prev => ({ ...prev, type: key })) }, label),
                ),
              )),
              h(Field, { label: priceLabel }, h(DebouncedNumber, {
                value: form.type === 'limit' ? form.limitPrice : form.price, min: 0, step: 0.01,
                onChange: value => setForm(prev => prev.type === 'limit'
                  ? { ...prev, limitPrice: value }
                  : { ...prev, price: value }),
              })),
              h('div', { className: 'pt-span-2' },
                quote
                  ? h('div', { className: 'pt-quote' },
                    h('span', null, symbolText(quote)),
                    h('span', null, `现价 ${money(quote.last)}`),
                    h('span', { className: 'pt-note' }, quote.source === 'manual' ? '手动价' : `更新 ${clockTime(quote.marketTs)}`),
                    h('span', { className: 'pt-note' }, `来源 ${quoteSourceText(quote)}`),
                  )
                  : h('div', { className: 'pt-note' }, quoteHint),
              ),
              h(Field, { label: '备注（复盘用）', span: true }, h('input', {
                className: 'pt-input', value: form.note, maxLength: 120,
                onChange: event => setForm(prev => ({ ...prev, note: event.target.value })),
              })),
              quoteError !== '' ? h('div', { className: 'pt-error pt-span-2' }, quoteError) : null,
            ),
            h('div', { className: 'pt-preview-pane' },
              h('div', { className: 'pt-card-title', style: { marginBottom: 6 } }, '预览'),
              preview ? (preview.price > 0 ? h('div', { className: 'pt-preview' },
                h('div', null, h('span', null, '预估成交价'), h('span', null, money(preview.price))),
                h('div', null, h('span', null, '金额'), h('span', null, cents(preview.amountCents))),
                h('div', null, h('span', null, '佣金'), h('span', null, cents(preview.commissionCents))),
                h('div', null, h('span', null, '印花税'), h('span', null, cents(preview.stampCents))),
                h('div', null, h('span', null, '过户费'), h('span', null, cents(preview.transferCents))),
                h('div', null, h('span', null, '成交后现金'),
                  h('span', { className: preview.cashAfterCents < 0 ? 'pt-risk-high' : undefined }, cents(preview.cashAfterCents)),
                ),
                h('div', null, h('span', null, '最多可买'), h('span', null, `${count(preview.maxBuyQty)} 股`)),
                previewState === 'loading' ? h('div', { className: 'pt-note' }, '计算中…') : null,
                preview.warnings.length > 0 ? h('div', { className: 'pt-warn' }, preview.warnings.join('；')) : null,
                previewState === 'error' && previewError !== '' ? h('div', { className: 'pt-warn' }, previewError) : null,
              ) : h('div', { className: 'pt-empty' }, '没有可用行情，请填写参考价或改用限价单')) : h('div', { className: 'pt-empty' }, emptyPreview),
            ),
          ),
          h('div', { className: 'pt-ticket-foot' },
            submitReason !== '' ? h('div', { className: 'pt-note' }, `不可提交：${submitReason}`) : null,
            h('button', {
              className: 'pt-btn pt-btn-primary pt-ticket-submit', onClick: onSubmit, title: submitReason || undefined,
              disabled: busy || submitReason !== '',
            }, form.side === 'buy' ? '买入' : '卖出'),
            h('div', { className: 'pt-ticket-meta' },
              h('span', { className: 'pt-note' },
                form.side === 'sell'
                  ? `可用 ${money(account.cash)}${preview ? ` · 可卖 ${count(preview.availableQty)} 股` : ''}`
                  : `可用 ${money(account.cash)}${preview ? ` · 最多可买 ${maxBuy} 股` : ''}`,
              ),
            ),
            receipt ? h(ReceiptLine, { receipt }) : null,
          ),
        ),
        h(TradeBook, { positions, pending, book, setBook, busy, onCancel, onSell }),
      )
    }

    /** Compact holdings/orders book, pinned under the ticket so the left column
        always reaches the K-line's bottom edge. */
    function TradeBook({ positions, pending, book, setBook, busy, onCancel, onSell }) {
      const showPositions = book === 'positions'
      return h('div', { className: 'pt-card pt-trade-book' },
        h('div', { className: 'pt-book-head' },
          h('div', { className: 'pt-seg' },
            h('button', { 'data-active': showPositions, onClick: () => setBook('positions') }, `持仓 ${positions.length}`),
            h('button', { 'data-active': !showPositions, onClick: () => setBook('orders') }, `挂单 ${pending.length}`),
          ),
          h('div', { className: 'pt-note' }, showPositions ? '成交后自动更新' : '未成交委托，可随时撤单'),
        ),
        h('div', { className: 'pt-book-scroll' },
          showPositions
            ? (positions.length === 0
              ? h('div', { className: 'pt-empty pt-book-empty' }, '无持仓 · 成交后自动显示')
              : h(Table, null,
                h('thead', null, h('tr', null,
                  ['代码', '名称', '数量', '可卖', '成本', '现价', '浮盈亏'].map(label => h('th', { key: label }, label)),
                  h('th', null, '操作'),
                )),
                h('tbody', null, positions.map(position => h('tr', { key: position.symbol },
                  h('td', null, bareSymbol(position.symbol)),
                  h('td', null, position.name ?? '—'),
                  h('td', null, count(position.qty)),
                  h('td', null, count(position.available)),
                  h('td', null, money(position.avgCost)),
                  h('td', null, money(position.lastPrice)),
                  h('td', { className: tone(position.unrealizedPnlCents ?? 0) }, cents(position.unrealizedPnlCents)),
                  h('td', null, h('button', {
                    className: 'pt-btn', onClick: () => onSell(position), disabled: !(position.available > 0),
                    title: position.available > 0 ? undefined : 'T+1：今日买入的股份明日可卖',
                  }, '卖出')),
                ))),
              ))
            : (pending.length === 0
              ? h('div', { className: 'pt-empty pt-book-empty' }, '无挂单 · 未成交的限价委托会停在这里')
              : h(Table, null,
                h('thead', null, h('tr', null,
                  ['代码', '方向', '类型', '数量', '限价', '状态'].map(label => h('th', { key: label }, label)),
                  h('th', null, '操作'),
                )),
                h('tbody', null, pending.map(order => h('tr', { key: order.id },
                  h('td', null, bareSymbol(order.symbol)),
                  h('td', null, order.side === 'buy' ? '买' : '卖'),
                  h('td', null, order.type === 'limit' ? '限价' : '市价'),
                  h('td', null, count(order.qty)),
                  h('td', null, order.limitPrice === undefined ? '—' : money(order.limitPrice)),
                  h('td', null, STATUS_TEXT[order.status] ?? order.status),
                  h('td', null, h('button', { className: 'pt-btn', onClick: () => onCancel(order.id), disabled: busy }, '撤单')),
                ))),
              )),
        ),
      )
    }

    /** Post-submit receipt, built from the ledger's fill record, not the draft. */
    function ReceiptLine({ receipt }) {
      if (receipt.failure !== undefined) {
        return h('div', { className: 'pt-receipt', 'data-state': 'rejected', title: receipt.failure.detail || undefined },
          `拒绝：${receipt.failure.text}`,
        )
      }
      const { order, fill, cash } = receipt
      const symbol = bareSymbol(order.symbol)
      const side = order.side === 'buy' ? '买入' : '卖出'
      if (order.status === 'rejected') {
        return h('div', { className: 'pt-receipt', 'data-state': 'rejected', title: order.reason || undefined },
          `拒绝：${side} ${symbol} ${count(order.qty)} 股 · ${reasonText(order.reason) || '未通过风控'}`,
        )
      }
      if (order.status === 'filled') {
        const price = fill ? fill.price : order.fillPrice
        const qty = fill ? fill.qty : order.filledQty
        const amount = fill ? fill.amountCents : order.amountCents
        const fees = fill ? fill.feesCents : order.feesCents
        return h('div', { className: 'pt-receipt', 'data-state': 'filled', title: order.id },
          `成交：${side} ${symbol} ${count(qty)} 股 · 价 ${money(price)} · 金额 ${cents(amount)} · 费用 ${cents(fees)} · 成交后现金 ${money(cash)} · 单 ${order.id}`,
        )
      }
      const pendingText = order.status === 'queued'
        ? '当前时段不撮合，进入连续竞价后按最新价判定'
        : '现价未穿越，成交前一直挂单'
      return h('div', { className: 'pt-receipt', 'data-state': 'resting', title: order.id },
        `挂单：${side} ${symbol} ${count(order.qty)} 股${order.limitPrice === undefined ? '' : ` @ ${money(order.limitPrice)}`} · ${pendingText} · 单 ${order.id}`,
      )
    }

    const marketSessionNote = session => {
      if (!session || session.canMatch) return ''
      if (session.phase === 'pre_open') return '集合竞价中，现价为最近一次行情'
      if (session.phase === 'auction_close') return '收盘竞价中，现价为最近一次行情'
      return '非交易时段，现价为最近一次行情'
    }

    function MarketTab({ searchQuery, setSearchQuery, runSearch, searchHits, searchAttempted, watchlist, isWatched, toggleWatch, marketList, marketBoard, setMarketBoard, watchOnly, setWatchOnly, loadMarket, busy, adoptQuote, session }) {
      const visibleQuotes = marketList === null
        ? []
        : marketList.quotes.filter(item => !watchOnly || isWatched(item.symbol)).slice(0, 50)
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'pt-card' },
          h('div', { className: 'pt-card-title' }, '搜索标的'),
          h('div', { className: 'pt-row' },
            h('input', {
              className: 'pt-input', style: { flex: 1, minWidth: 200 }, value: searchQuery,
              placeholder: '代码或名称，例如 600519 / 贵州茅台',
              onChange: event => setSearchQuery(event.target.value),
              onKeyDown: event => { if (event.key === 'Enter') void runSearch() },
            }),
            h('button', { className: 'pt-btn', onClick: runSearch, disabled: busy }, '搜索'),
          ),
          searchHits.length > 0 ? h('div', { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 } },
            searchHits.map(hit => h('div', { key: hit.symbol, className: 'pt-row' },
              h('button', {
                className: 'pt-btn', style: { flex: 1, justifyContent: 'flex-start' },
                onClick: () => adoptQuote(hit.symbol, null),
              }, `${bareSymbol(hit.symbol)} ${hit.name ?? ''}`),
              h('button', { className: 'pt-btn', onClick: () => toggleWatch(hit.symbol) }, isWatched(hit.symbol) ? '已自选' : '加自选'),
            )),
          ) : searchAttempted ? h('div', { className: 'pt-empty', style: { marginTop: 8 } }, '没有找到匹配标的') : null,
        ),
        h('div', { className: 'pt-card' },
          h('div', { className: 'pt-row' },
            h('div', { className: 'pt-card-title', style: { margin: 0 } }, '全市场'),
            [['main', '主板'], ['star', '科创板'], ['chi_next', '创业板'], ['bjse', '北交所'], ['xshg', '沪市'], ['xshe', '深市']].map(([key, label]) =>
              h('button', { key, className: 'pt-btn', 'data-active': marketBoard === key, onClick: () => setMarketBoard(key) }, label),
            ),
            h('button', { className: 'pt-btn', 'data-active': watchOnly, onClick: () => setWatchOnly(value => !value) }, '只看自选'),
            h('span', { className: 'pt-note' }, `第 ${marketList?.page ?? 1} 页`),
            h('button', {
              className: 'pt-btn', onClick: () => loadMarket(Math.max(1, (marketList?.page ?? 1) - 1)),
              disabled: marketList === null || (marketList.page ?? 1) <= 1,
            }, '上一页'),
            h('button', {
              className: 'pt-btn', onClick: () => loadMarket((marketList?.page ?? 1) + 1),
              disabled: marketList !== null && marketList.quotes.length < 50,
            }, '下一页'),
          ),
          marketSessionNote(session) !== ''
            ? h('div', { className: 'pt-note' }, marketSessionNote(session))
            : null,
          marketList === null ? h('div', { className: 'pt-empty' }, '加载行情…')
            : marketList.quotes.length === 0 ? h('div', { className: 'pt-empty' }, marketList.notice ?? '没有行情')
              : visibleQuotes.length === 0
                ? h('div', { className: 'pt-empty' }, watchOnly
                  ? (watchlist.length === 0 ? '还没有自选，点行情行的 ☆ 添加' : '本页没有自选，可翻页或关闭「只看自选」')
                  : '没有行情')
                : h(Table, null,
                h('thead', null, h('tr', null, ['代码', '名称', '现价', '涨跌幅', '自选'].map(label => h('th', { key: label }, label)))),
                h('tbody', null, visibleQuotes.map(item => {
                  const change = item.prevClose && item.prevClose > 0 ? (item.last - item.prevClose) / item.prevClose : null
                  return h('tr', {
                    key: `${item.symbol}-${item.last}`, style: { cursor: 'pointer' },
                    onClick: () => adoptQuote(item.symbol, item),
                  },
                    h('td', null, bareSymbol(item.symbol)),
                    h('td', null, item.name ?? '—'),
                    h('td', null, money(item.last)),
                    h('td', { className: tone(change ?? 0) }, change === null ? '—' : pct(change)),
                    h('td', null, h('button', { className: 'pt-btn', onClick: event => { event.stopPropagation(); void toggleWatch(item.symbol) } }, isWatched(item.symbol) ? '★' : '☆')),
                  )
                })),
              ),
        ),
      )
    }

    function PositionsTab({ positions, onSell }) {
      if (positions.length === 0) return h('div', { className: 'pt-empty' }, '无持仓 · 成交后自动显示，可在交易页下单')
      return h(Table, null,
        h('thead', null, h('tr', null,
          ['代码', '名称', '数量', '可卖', '成本', '现价', '浮盈亏'].map(label => h('th', { key: label }, label)),
          h('th', null, '操作'),
        )),
        h('tbody', null, positions.map(position => h('tr', { key: position.symbol },
          h('td', null, bareSymbol(position.symbol)),
          h('td', null, position.name ?? '—'),
          h('td', null, count(position.qty)),
          h('td', null, count(position.available)),
          h('td', null, money(position.avgCost)),
          h('td', null, money(position.lastPrice)),
          h('td', { className: tone(position.unrealizedPnlCents ?? 0) }, cents(position.unrealizedPnlCents)),
          h('td', null, h('button', {
            className: 'pt-btn',
            onClick: () => onSell(position),
            disabled: !(position.available > 0),
            title: position.available > 0 ? undefined : 'T+1：今日买入的股份明日可卖',
          }, '卖出')),
        ))),
      )
    }

    function OrdersTab({ pending, history, busy, onCancel }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', null,
          h('div', { className: 'pt-sub' }, '挂单'),
          pending.length === 0 ? h('div', { className: 'pt-empty' }, '无挂单') : h(Table, null,
            h('thead', null, h('tr', null, ['代码', '方向', '类型', '数量', '限价', '状态', '备注', '操作'].map(label => h('th', { key: label }, label)))),
            h('tbody', null, pending.map(order => h('tr', { key: order.id },
              h('td', null, bareSymbol(order.symbol)),
              h('td', null, order.side === 'buy' ? '买' : '卖'),
              h('td', null, order.type === 'limit' ? '限价' : '市价'),
              h('td', null, count(order.qty)),
              h('td', null, order.limitPrice === undefined ? '—' : money(order.limitPrice)),
              h('td', null, STATUS_TEXT[order.status] ?? order.status),
              h('td', { title: order.note ?? undefined }, order.note === undefined ? '' : h('span', { className: 'pt-note-cell' }, order.note)),
              h('td', null, h('button', { className: 'pt-btn', onClick: () => onCancel(order.id), disabled: busy }, '撤单')),
            ))),
          ),
          pending.some(order => order.status === 'queued')
            ? h('div', { className: 'pt-note' }, '「排队」：当前时段不撮合，下一交易时段会尝试成交，可随时撤单。')
            : null,
        ),
        h('div', null,
          h('div', { className: 'pt-sub' }, '历史'),
          history.length === 0 ? h('div', { className: 'pt-empty' }, '无历史订单') : h(Table, null,
            h('thead', null, h('tr', null, ['时间', '代码', '方向', '数量', '限价', '状态', '成交价', '原因', '备注'].map(label => h('th', { key: label }, label)))),
            h('tbody', null, history.slice(0, 30).map(order => h('tr', { key: order.id },
              h('td', null, dateTime(order.createdAt)),
              h('td', null, bareSymbol(order.symbol)),
              h('td', null, order.side === 'buy' ? '买' : '卖'),
              h('td', null, count(order.qty)),
              h('td', null, order.limitPrice === undefined ? '—' : money(order.limitPrice)),
              h('td', null, STATUS_TEXT[order.status] ?? order.status),
              h('td', null, order.fillPrice === undefined ? '—' : money(order.fillPrice)),
              h('td', { title: order.reason ?? undefined }, reasonText(order.reason)),
              h('td', { title: order.note ?? undefined }, order.note === undefined ? '' : h('span', { className: 'pt-note-cell' }, order.note)),
            ))),
          ),
          history.length > 30 ? h('div', { className: 'pt-note' }, `仅显示最近 30 条，共 ${history.length} 条`) : null,
        ),
      )
    }

    function ReviewTab({ review, period, setPeriod, trades, daily, cashFlow, trips }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'pt-row' }, PERIODS.map(([key, label]) =>
          h('button', {
            key, className: 'pt-btn', 'data-active': period === key,
            onClick: () => setPeriod(key),
          }, label),
        )),
        review ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { className: 'pt-stats' },
            h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '成交笔数'), h('div', { className: 'pt-stat-value' }, count(review.tradeCount))),
            h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '已实现盈亏'), h('div', { className: `pt-stat-value ${tone(review.realizedPnl)}` }, signed(review.realizedPnl))),
            h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '费用合计'), h('div', { className: 'pt-stat-value' }, money(review.totalFees))),
            h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '最大回撤'), h('div', { className: 'pt-stat-value' }, pct(review.maxDrawdownPct))),
          ),
          h('div', { className: 'pt-chart-wrap' }, h(EquityChart, { points: review.equityCurve })),
          h('div', null,
            h('div', { className: 'pt-sub' }, '成交记录'),
            trades.length === 0 ? h('div', { className: 'pt-empty' }, '无成交') : h(Table, null,
              h('thead', null, h('tr', null, ['时间', '代码', '方向', '数量', '价格', '金额', '费用'].map(label => h('th', { key: label }, label)))),
              h('tbody', null, trades.slice(0, 30).map(trade => h('tr', { key: trade.id },
                h('td', null, dateTime(trade.ts)),
                h('td', null, bareSymbol(trade.symbol)),
                h('td', null, trade.side === 'buy' ? '买' : '卖'),
                h('td', null, count(trade.qty)),
                h('td', null, money(trade.price)),
                h('td', null, cents(trade.amountCents)),
                h('td', null, cents(trade.feesCents)),
              ))),
            ),
            trades.length > 30 ? h('div', { className: 'pt-note' }, `仅显示最近 30 条，共 ${trades.length} 条`) : null,
          ),
          h('div', null,
            h('div', { className: 'pt-sub' }, '日终报告'),
            daily.length === 0 ? h('div', { className: 'pt-empty' }, '暂无日终快照') : h(Table, null,
              h('thead', null, h('tr', null, ['日期', '权益', '当日盈亏', '费用', '收盘价来源'].map(label => h('th', { key: label }, label)))),
              h('tbody', null, daily.slice(-14).reverse().map(row => h('tr', { key: row.date },
                h('td', null, row.date),
                h('td', null, money(row.equity)),
                h('td', { className: tone(row.dayPnl) }, signed(row.dayPnl)),
                h('td', null, money(row.fees)),
                h('td', null, row.closeSource === 'daily' ? '日K收盘' : row.closeSource === 'last' ? '最后报价' : '缺失'),
              ))),
            ),
            daily.length > 14 ? h('div', { className: 'pt-note' }, `仅显示最近 14 个交易日，共 ${daily.length} 个`) : null,
          ),
          h('div', null,
            h('div', { className: 'pt-sub' }, '资金流水'),
            cashFlow.length === 0 ? h('div', { className: 'pt-empty' }, '暂无流水') : h(Table, null,
              h('thead', null, h('tr', null, ['时间', '类型', '金额', '余额'].map(label => h('th', { key: label }, label)))),
              h('tbody', null, cashFlow.slice(-30).reverse().map((row, index) => h('tr', { key: `${row.ts}-${index}` },
                h('td', null, dateTime(row.ts)),
                h('td', null, CASH_TYPE_TEXT[row.type] ?? row.type),
                h('td', { className: tone(row.amount) }, signed(row.amount)),
                h('td', null, money(row.balance)),
              ))),
            ),
            cashFlow.length > 30 ? h('div', { className: 'pt-note' }, `仅显示最近 30 条，共 ${cashFlow.length} 条`) : null,
          ),
          h('div', null,
            h('div', { className: 'pt-sub' }, '回合统计（按标的）'),
            trips.length === 0 ? h('div', { className: 'pt-empty' }, '暂无已平仓记录') : h(Table, null,
              h('thead', null, h('tr', null, ['代码', '数量', '成本', '收入', '盈亏', '持有天数'].map(label => h('th', { key: label }, label)))),
              h('tbody', null, trips.slice(-30).reverse().map(trip => h('tr', { key: trip.symbol },
                h('td', null, bareSymbol(trip.symbol)),
                h('td', null, count(trip.qty)),
                h('td', null, money(trip.cost)),
                h('td', null, money(trip.proceeds)),
                h('td', { className: tone(trip.pnl) }, signed(trip.pnl)),
                h('td', null, count(trip.holdingDays)),
              ))),
            ),
            trips.length > 30 ? h('div', { className: 'pt-note' }, `仅显示最近 30 条，共 ${trips.length} 条`) : null,
          ),
        ) : h('div', { className: 'pt-empty' }, '加载复盘…'),
      )
    }

    /* --------------------------------------------------------- basket ----- */

    /**
     * Basket import: CSV in, host-computed plan out. Confirming submits the
     * plan's `{symbol, qty}` rows verbatim, so the quantities the user sees are
     * the quantities that reach the ledger. All state is local: leaving the tab
     * unmounts the panel and clears the import.
     */
    function BasketTab({ account, onDone, resetNonce }) {
      const [csv, setCsv] = useState('')
      const [fileName, setFileName] = useState('')
      const [budget, setBudget] = useState('')
      const [preview, setPreview] = useState(null)
      const [result, setResult] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      // Frozen when a preview succeeds: retrying a lost response must resend
      // the same batchId, otherwise the host would buy the basket twice.
      const [batchId, setBatchId] = useState('')
      const placing = useRef(false)
      // A preview is only valid for the CSV/budget it was computed from.
      const previewSeq = useRef(0)
      // A reset changes the cash the preview was based on: drop it.
      useEffect(() => {
        previewSeq.current += 1
        setBusy(false)
        setPreview(null)
        setResult(null)
        setBatchId('')
        setError('')
      }, [resetNonce])
      const nextBatchId = () => typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `basket-${Date.now()}-${Math.random().toString(36).slice(2)}`

      // Empty means "host uses the available cash"; the input is yuan, cents go out.
      const budgetCents = useMemo(() => {
        const text = budget.trim()
        if (text === '') return undefined
        const value = Number(text)
        return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : NaN
      }, [budget])

      const budgetInvalid = budget.trim() !== '' && Number.isNaN(budgetCents)

      const readFile = useCallback(async event => {
        const file = event.target.files && event.target.files[0]
        // Clear the value so picking the same file again still fires a change.
        event.target.value = ''
        if (!file) return
        previewSeq.current += 1
        setBusy(false)
        setError('')
        setPreview(null)
        setResult(null)
        setBatchId('')
        setFileName(file.name)
        // The RPC has the same cap; catching it here gives instant feedback.
        if (file.size > 32 * 1024) {
          setCsv('')
          setError('CSV 文件不能超过 32 KiB')
          return
        }
        try {
          setCsv(await file.text())
        } catch {
          setError('读取文件失败')
        }
      }, [])

      const runPreview = useCallback(async () => {
        if (csv.trim() === '') return
        if (Number.isNaN(budgetCents)) {
          setError('预算需为正数')
          return
        }
        const seq = ++previewSeq.current
        const sourceCsv = csv
        setBusy(true)
        setError('')
        setResult(null)
        try {
          const payload = { csv: sourceCsv }
          if (budgetCents !== undefined) payload.budgetCents = budgetCents
          const next = await rpc('basket/preview', payload)
          // A file/budget change while the request was in flight wins.
          if (seq !== previewSeq.current) return
          setPreview(next)
          setBatchId(nextBatchId())
        } catch (cause) {
          if (seq === previewSeq.current) {
            setError(errorOf(cause).text)
            setPreview(null)
          }
        } finally {
          if (seq === previewSeq.current) setBusy(false)
        }
      }, [csv, budgetCents])

      const rows = useMemo(
        () => preview === null ? [] : preview.rows.filter(row => row.qty > 0).map(row => ({ symbol: row.symbol, qty: row.qty })),
        [preview],
      )
      const placeReason = useMemo(() => {
        if (account !== null && account.blocked === true) return '账户已锁定'
        if (preview === null) return '先预览配股'
        if (rows.length === 0) return '没有可下单的行'
        if (preview.session && preview.session.canMatch === false) return '当前时段不能市价成交'
        return ''
      }, [account, preview, rows])

      const place = useCallback(async () => {
        if (busy || placeReason !== '' || placing.current) return
        placing.current = true
        setBusy(true)
        setError('')
        try {
          // Reuse the preview's id: a retry after a lost response must be
          // idempotent on the host, not a second purchase.
          const id = batchId !== '' ? batchId : nextBatchId()
          setResult(await rpc('basket/place', { batchId: id, rows }))
          if (typeof onDone === 'function') await onDone()
        } catch (cause) {
          setError(errorOf(cause).text)
        } finally {
          placing.current = false
          setBusy(false)
        }
      }, [busy, placeReason, rows, onDone, batchId])

      return h('div', { className: 'pt-trade' },
        h('div', { className: 'pt-card pt-ticket-card' },
          h('div', { className: 'pt-card-title' }, '导入组合'),
          h('div', { className: 'pt-row' },
            h(Field, { label: 'CSV 文件' }, h('input', {
              className: 'pt-input', type: 'file', accept: '.csv,text/csv', onChange: readFile,
            })),
            fileName !== '' ? h('div', { className: 'pt-note' }, fileName) : null,
            h(Field, { label: '预算（元）' }, h('input', {
              className: 'pt-input', style: { width: 140 }, value: budget, inputMode: 'decimal',
              placeholder: account === null ? '默认可用现金' : `默认可用 ${money(account.cash)}`,
              onChange: event => {
                previewSeq.current += 1
                setBusy(false)
                setBudget(budgetInput(event.target.value))
                setPreview(null)
                setResult(null)
                setBatchId('')
                setError('')
              },
            })),
            h('button', {
              className: 'pt-btn pt-btn-primary', onClick: runPreview, disabled: busy || csv.trim() === '' || budgetInvalid,
              title: budgetInvalid ? '预算需为正数' : csv.trim() === '' ? '请先选择 CSV 文件' : undefined,
            }, busy ? '预览中…' : '预览配股'),
            budgetInvalid ? h('div', { className: 'pt-note pt-risk-high' }, '预算需为正数') : null,
          ),
          h('div', { className: 'pt-note' }, csv.trim() === ''
            ? '先选择 CSV 文件；两列「代码,权重」，最多 20 只'
            : '两列「代码,权重」，最多 20 只；仅连续竞价时段可下单'),
          error !== '' ? h('div', { className: 'pt-error', style: { marginTop: 8 } }, error) : null,
        ),
        preview !== null ? h('div', { className: 'pt-card' },
          h('div', { className: 'pt-card-title' }, '预览'),
          h(Table, null,
            h('thead', null, h('tr', null,
              ['代码', '名称', '目标权重', '目标金额', '股数', '金额', '费用', '实际权重', '状态'].map(label => h('th', { key: label }, label)),
            )),
            h('tbody', null, preview.rows.map(row => h('tr', { key: row.symbol },
              h('td', null, bareSymbol(row.symbol)),
              h('td', null, row.name ?? '—'),
              h('td', null, pct(row.weight)),
              h('td', null, cents(row.targetCents)),
              h('td', null, count(row.qty)),
              h('td', null, cents(row.amountCents)),
              h('td', null, cents(row.feesCents)),
              h('td', null, pct(row.actualWeight)),
              h('td', {
                title: row.warning || undefined,
                className: row.status === 'ok' ? undefined : 'pt-note',
              }, BASKET_STATUS_TEXT[row.status] ?? row.status),
            ))),
          ),
          h('div', { className: 'pt-quote', style: { marginTop: 8 } },
            [['合计金额', preview.totalAmountCents], ['费用', preview.totalFeesCents],
              ['剩余现金', preview.residualCents], ['成交后现金', preview.cashAfterCents]].map(([label, value]) =>
              h('span', { key: label }, `${label} ${cents(value)}`)),
          ),
          preview.issues.length > 0 ? h('div', { className: 'pt-error', style: { marginTop: 8 } },
            preview.issues.map(issue => `${issue.line > 0 ? `第 ${issue.line} 行：` : ''}${issue.message}`).join('；'),
          ) : null,
          preview.warnings.length > 0 ? h('div', { className: 'pt-note', style: { marginTop: 8 } }, preview.warnings.join('；')) : null,
          h('div', { className: 'pt-row', style: { marginTop: 8 } },
            placeReason !== '' ? h('div', { className: 'pt-note', style: { marginRight: 'auto' } }, placeReason) : null,
            h('button', {
              className: 'pt-btn pt-btn-primary', onClick: place, disabled: busy || placeReason !== '',
              title: placeReason || undefined,
            }, busy ? '提交中…' : '确认下单'),
          ),
        ) : null,
        result !== null ? h('div', { className: 'pt-card' },
          h('div', { className: 'pt-card-title' }, '下单结果'),
          h(Table, null,
            h('thead', null, h('tr', null,
              ['代码', '状态', '数量', '成交价', '原因'].map(label => h('th', { key: label }, label)),
            )),
            h('tbody', null, result.rows.map(row => h('tr', { key: row.symbol },
              h('td', null, bareSymbol(row.symbol)),
              h('td', null, row.order ? STATUS_TEXT[row.order.status] ?? row.order.status : '拒绝'),
              h('td', null, count(row.order ? row.order.qty : undefined)),
              h('td', null, row.order && row.order.fillPrice !== undefined ? money(row.order.fillPrice) : '—'),
              h('td', { title: row.error ?? row.order?.reason ?? undefined }, reasonText(row.error ?? row.order?.reason)),
            ))),
          ),
          h('div', { className: 'pt-note', style: { marginTop: 8 } }, `成交后现金 ${cents(result.cashAfterCents)}`),
        ) : null,
      )
    }

    /* -------------------------------------------------------- futures ----- */

    /**
     * Futures dashboard: its own endpoints, polling loop and reset. The stock
     * half never reads this state, so either account can fail or reset alone.
     */
    function FuturesDashboard({ accountSwitch }) {
      const [account, setAccount] = useState(null)
      const [status, setStatus] = useState(null)
      const [positions, setPositions] = useState([])
      const [orders, setOrders] = useState([])
      const [review, setReview] = useState(null)
      const [period, setPeriod] = useState('30d')
      const reviewSeq = useRef(0)
      const [tab, setTab] = useState('trade')
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState(false)
      const submitting = useRef(false)
      const placeKey = useRef({ key: '', id: '' })
      const [searchQuery, setSearchQuery] = useState('')
      const [searching, setSearching] = useState(false)
      const [contracts, setContracts] = useState(null)
      const [contractNotice, setContractNotice] = useState('')
      const [contract, setContract] = useState(null)
      const [quote, setQuote] = useState(null)
      const [quoteNotice, setQuoteNotice] = useState('')
      const quoteSeq = useRef(0)
      const contractSeq = useRef(0)
      const [preview, setPreview] = useState(null)
      const [previewState, setPreviewState] = useState('idle')
      const [previewError, setPreviewError] = useState('')
      const [previewNonce, setPreviewNonce] = useState(0)
      const [receipt, setReceipt] = useState(null)
      const [form, setForm] = useState({
        side: 'long', offset: 'open', type: 'market', qty: '1', limitPrice: '', price: '', note: '',
      })

      const alive = useRef(true)
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
      }, [])

      const loadAll = useCallback(async (quiet = false) => {
        try {
          const [nextAccount, nextStatus, nextPositions, nextOrders] = await Promise.all([
            rpc('futures/account/get'),
            rpc('futures/status'),
            rpc('futures/positions'),
            rpc('futures/orders'),
          ])
          if (!alive.current) return null
          setAccount(nextAccount)
          setStatus(nextStatus)
          setPositions(nextPositions)
          setOrders(nextOrders)
          if (!quiet) setError(null)
          return { account: nextAccount }
        } catch (cause) {
          if (alive.current) setError(errorOf(cause))
          return null
        }
      }, [])

      useEffect(() => { loadAll() }, [loadAll])

      const loadReview = useCallback(async (key = period) => {
        const seq = ++reviewSeq.current
        try {
          const next = await rpc('futures/review', { period: key })
          if (alive.current && seq === reviewSeq.current) setReview(next)
        } catch (cause) {
          if (alive.current && seq === reviewSeq.current) setError(errorOf(cause))
        }
      }, [period])

      useEffect(() => {
        if (tab === 'review') void loadReview()
      }, [tab, loadReview])

      const fetchQuote = useCallback(async symbol => {
        const seq = ++quoteSeq.current
        try {
          const result = await rpc('futures/quote', { symbols: [symbol] })
          // A slower quote for a previously selected contract must not paint
          // over the one the user is looking at now.
          if (!alive.current || seq !== quoteSeq.current) return
          setQuote(result.quotes[0] ?? null)
          setQuoteNotice(result.quotes.length === 0 ? (result.notice ?? '取不到行情，可手填参考价') : '')
        } catch {
          if (!alive.current || seq !== quoteSeq.current) return
          setQuote(null)
          setQuoteNotice('取不到行情，可手填参考价')
        }
      }, [])

      // The host scheduler settles; this is the visible-panel extra trigger.
      const poll = useCallback(async () => {
        try {
          const tick = await rpc('futures/tick')
          if (!alive.current) return
          if (tick.filled.length > 0) setNotice(`成交 ${tick.filled.length} 笔`)
          if (tick.notices.length > 0) setNotice(tick.notices.join('；'))
          await loadAll(true)
          // Keep the selected contract's price and estimate moving while the
          // panel is open; without this the ticket showed the selection price
          // until the next edit.
          if (!alive.current || contract === null) return
          void fetchQuote(contract.symbol)
          setPreviewNonce(value => value + 1)
        } catch {
          // Polling failures stay silent; the manual refresh shows the error.
        }
      }, [loadAll, contract, fetchQuote])

      useEffect(() => {
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') poll()
        }, 5000)
        return () => clearInterval(timer)
      }, [poll])

      const searchContracts = useCallback(async (refresh = false) => {
        const seq = ++contractSeq.current
        setSearching(true)
        try {
          const payload = { limit: 20 }
          if (searchQuery.trim() !== '') payload.query = searchQuery.trim()
          if (refresh) payload.refresh = true
          const result = await rpc('futures/contracts', payload)
          if (!alive.current || seq !== contractSeq.current) return
          setContracts(result.contracts ?? [])
          setContractNotice(result.notice ?? '')
        } catch (cause) {
          if (alive.current && seq === contractSeq.current) setError(errorOf(cause))
        } finally {
          if (alive.current && seq === contractSeq.current) setSearching(false)
        }
      }, [searchQuery])

      const selectContract = useCallback(next => {
        setContract(next)
        setContracts(null)
        setQuote(null)
        setQuoteNotice('')
        setPreview(null)
        setPreviewError('')
        setPreviewNonce(value => value + 1)
        void fetchQuote(next.symbol)
      }, [fetchQuote])

      /** Closing from a book only fills the ticket; the user still confirms. */
      const selectPosition = useCallback(position => {
        setContract({
          symbol: position.symbol,
          name: position.name,
          multiplier: position.multiplier,
          marginRate: position.marginRate,
          deListDate: position.deListDate,
        })
        setQuote(null)
        setQuoteNotice('')
        setPreview(null)
        setForm(prev => ({ ...prev, side: position.side, offset: 'close', type: 'market', qty: String(position.qty) }))
        setTab('trade')
        setPreviewNonce(value => value + 1)
        void fetchQuote(position.symbol)
      }, [fetchQuote])

      const futuresDraft = useCallback(() => ({
        symbol: contract === null ? '' : contract.symbol,
        side: form.side,
        offset: form.offset,
        type: form.type,
        qty: Number(form.qty),
        limitPrice: form.type === 'limit' ? Number(form.limitPrice) : undefined,
        // Manual fallback only for a market close, per the contract's draft shape.
        price: form.type === 'market' && form.offset === 'close' && form.price !== '' ? Number(form.price) : undefined,
        note: form.note.trim() === '' ? undefined : form.note.trim(),
      }), [contract, form])

      const previewDraft = useCallback(() => contract === null ? null : {
        symbol: contract.symbol,
        side: form.side,
        offset: form.offset,
        type: form.type,
        qty: Number(form.qty),
        limitPrice: form.type === 'limit' ? Number(form.limitPrice) : undefined,
        price: form.type === 'market' && form.offset === 'close' && form.price !== '' ? Number(form.price) : undefined,
      }, [
        contract, form.side, form.offset, form.type, form.qty, form.limitPrice, form.price,
      ])

      const previewSeq = useRef(0)
      useEffect(() => {
        previewSeq.current += 1
        const seq = previewSeq.current
        const draft = previewDraft()
        if (draft === null) {
          setPreview(null)
          setPreviewState('idle')
          setPreviewError('')
          return
        }
        if (!Number.isInteger(draft.qty) || draft.qty <= 0 || (draft.type === 'limit' && !(draft.limitPrice > 0))) {
          setPreview(null)
          setPreviewState('idle')
          setPreviewError('')
          return
        }
        setPreviewState('loading')
        const timer = setTimeout(() => {
          rpc('futures/preview', draft)
            .then(result => {
              if (!alive.current || seq !== previewSeq.current) return
              setPreview(result)
              setPreviewError('')
              setPreviewState('ready')
            })
            .catch(cause => {
              if (!alive.current || seq !== previewSeq.current) return
              setPreviewError(errorOf(cause).text)
              setPreviewState('error')
            })
        }, 300)
        return () => clearTimeout(timer)
      }, [previewDraft, previewNonce])

      const pending = useMemo(() => orders.filter(order => order.status === 'pending'), [orders])
      const history = useMemo(() => orders.filter(order => order.status !== 'pending'), [orders])

      const previewHint = useMemo(() => {
        if (contract === null) return '搜索并选择合约后自动计算'
        if (!Number.isInteger(Number(form.qty)) || Number(form.qty) <= 0) return '填写手数后自动计算'
        if (form.type === 'limit' && !(Number(form.limitPrice) > 0)) return '填写限价后自动计算'
        return ''
      }, [contract, form.qty, form.type, form.limitPrice])

      const submitReason = useMemo(() => {
        if (account === null) return '加载账户中'
        if (account.blocked === true) return '账户已锁定'
        if (contract === null) return '选择合约'
        if (String(form.qty).trim() === '') return '填写手数'
        const qty = Number(form.qty)
        if (!Number.isInteger(qty) || qty <= 0) return '手数需为正整数'
        if (form.type === 'limit' && !(Number(form.limitPrice) > 0)) return '填写限价'
        if (form.type === 'limit' && preview !== null && preview.limit !== undefined) {
          const price = Number(form.limitPrice)
          if (price < preview.limit.lower || price > preview.limit.upper) return '价格超出涨跌停'
        }
        if (status !== null && status.canSubmit === false) return '当前时段不可下单'
        if (form.type === 'market' && status !== null && status.canMatch === false) return '当前时段不能市价成交'
        const hasQuote = quote !== null
          || (quoteNotice === '' && preview !== null && preview.quote !== undefined && preview.quote !== null)
        if (form.type === 'market' && !hasQuote && !(form.offset === 'close' && Number(form.price) > 0)) return '等待行情'
        if (form.offset === 'close' && preview !== null && qty > preview.availableCloseQty) return '可平手数不足'
        if (form.offset === 'open' && preview !== null && preview.cashAfterCents < 0) return '保证金不足'
        return ''
      }, [account, contract, form, status, preview, quote, quoteNotice])

      const doSubmit = useCallback(async () => {
        if (submitReason !== '' || submitting.current) return
        submitting.current = true
        setBusy(true)
        setReceipt(null)
        try {
          const current = futuresDraft()
          const key = JSON.stringify(current)
          if (placeKey.current.key !== key) {
            placeKey.current = {
              key,
              id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            }
          }
          const order = await rpc('futures/order', { draft: current, requestId: placeKey.current.id })
          const snapshot = await loadAll(true)
          setReceipt({ order, cash: snapshot === null ? undefined : snapshot.account.cash })
          placeKey.current = { key: '', id: '' }
          setPreviewNonce(value => value + 1)
        } catch (cause) {
          setReceipt({ failure: errorOf(cause) })
        } finally {
          submitting.current = false
          setBusy(false)
        }
      }, [submitReason, futuresDraft, loadAll])

      const cancel = useCallback(async orderId => {
        setBusy(true)
        try {
          await rpc('futures/cancel', { orderId })
          await loadAll(true)
        } catch (cause) {
          setError(errorOf(cause))
        } finally {
          setBusy(false)
        }
      }, [loadAll])

      const copyLedgerPath = useCallback(async () => {
        const path = account !== null ? account.ledgerPath : undefined
        if (path === undefined) return
        const copied = typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText
          ? await navigator.clipboard.writeText(path).then(() => true, () => false)
          : false
        setNotice(copied ? `已复制账本路径：${path}` : `账本路径：${path}`)
      }, [account])

      const exportLedger = useCallback(async () => {
        try {
          const result = await rpc('futures/account/export')
          if (!result.exists || !result.content) {
            setNotice(result.notice ?? '账本文件尚未创建')
            return
          }
          if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
            const blob = new Blob([result.content], { type: 'application/x-ndjson' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = 'futures-events.jsonl'
            link.click()
            URL.revokeObjectURL(url)
          }
          setNotice(`已导出期货账本：${result.path}`)
        } catch (cause) {
          setError(errorOf(cause))
        }
      }, [])

      const refreshAll = useCallback(async () => {
        setBusy(true)
        try {
          await loadAll()
          if (tab === 'review') await loadReview()
          if (contract !== null) void fetchQuote(contract.symbol)
          setPreviewNonce(value => value + 1)
        } finally {
          setBusy(false)
        }
      }, [loadAll, loadReview, tab, contract, fetchQuote])

      const reset = useCallback(async () => {
        if (!window.confirm('重置期货模拟账户？持仓与挂单会清空，账本会先备份。')) return
        setBusy(true)
        try {
          setAccount(await rpc('futures/account/reset', { confirm: true }))
          setPreview(null)
          setReceipt(null)
          await loadAll(true)
          if (tab === 'review') await loadReview()
          setPreviewNonce(value => value + 1)
          setNotice('期货账户已重置')
        } catch (cause) {
          setError(errorOf(cause))
        } finally {
          setBusy(false)
        }
      }, [loadAll, loadReview, tab])

      if (account === null) {
        return h('div', { className: 'pt-inner' },
          h('div', { className: 'pt-head' },
            h('div', null, h('h3', { className: 'pt-title' }, '模拟交易'), h('div', { className: 'pt-sub' }, '期货账户')),
            h('div', { className: 'pt-row' }, accountSwitch,
              h('button', { className: 'pt-btn', onClick: () => { setError(null); void loadAll() } }, '重试'),
            ),
          ),
          error
            ? h('div', { className: 'pt-error', title: error.detail || undefined }, error.text)
            : h('div', { className: 'pt-empty' }, '加载期货模拟交易…'),
        )
      }

      // Amber from the configured warning line (80% by default), never hard-coded.
      const riskWarn = isFiniteNumber(account.riskRatio) && account.riskRatio >= (account.settings?.warnRiskRatio ?? 0.8)
      const displayQuote = quote ?? (quoteNotice === '' && preview !== null ? preview.quote ?? null : null)
      const tabBar = h('div', { className: 'pt-tabs' }, FUTURES_TABS.map(key => {
        const badge = key === 'positions' ? ` ${positions.length}` : key === 'orders' ? ` ${pending.length}` : ''
        return h('button', {
          key, className: 'pt-tab', 'data-active': tab === key, onClick: () => setTab(key),
        }, `${FUTURES_TAB_LABEL[key]}${badge}`)
      }))
      const tabBody = tab === 'trade'
        ? h(FuturesTradeTab, {
          account, searchQuery, setSearchQuery, searchContracts, searching, contracts, contractNotice,
          contract, selectContract, form, setForm, quote: displayQuote, quoteNotice,
          preview, previewState, previewError, previewHint,
          busy, onSubmit: doSubmit, submitReason, receipt,
          positions, pending, onCancel: cancel, onClose: selectPosition,
        })
        : tab === 'positions'
          ? h(FuturesPositionsTab, { positions, onClose: selectPosition })
          : tab === 'orders'
            ? h(FuturesOrdersTab, { pending, history, busy, onCancel: cancel })
            : h(FuturesReviewTab, {
              review, period,
              setPeriod: key => setPeriod(key),
            })

      return h('div', { className: 'pt-inner' },
        h('div', { className: 'pt-head' },
          h('div', null,
            h('h3', { className: 'pt-title' }, '模拟交易'),
            h('div', { className: 'pt-sub' },
              `期货 · ${tradeDateText(account.tradeDate)} · ${status ? FUTURES_PHASE_TEXT[status.phase] : '时段未知'} · 初始 ${money(account.initialCash)} · ${account.blocked ? '已锁定' : '运行中'}`,
              status && !status.canSubmit ? h('span', { className: 'pt-note' }, '（当前时段只读）') : null,
            ),
          ),
          h('div', { className: 'pt-row' },
            accountSwitch,
            h('button', { className: 'pt-btn', onClick: refreshAll, disabled: busy }, '刷新'),
            h('button', { className: 'pt-btn pt-btn-danger', onClick: reset, disabled: busy }, '重置'),
          ),
        ),
        account.blocked ? h('div', { className: 'pt-blocked' },
          h('div', { className: 'pt-blocked-text' },
            h('div', null, '期货账本校验失败，账户已锁定。'),
            account.blockedReason ? h('div', { className: 'pt-blocked-detail', title: account.blockedReason }, `原因：${account.blockedReason}`) : null,
            account.ledgerPath ? h('div', { className: 'pt-blocked-detail', title: account.ledgerPath }, `账本：${account.ledgerPath}`) : null,
            h('div', { className: 'pt-blocked-hint' }, '修复后需完全退出并重开 DSH；重置会先备份。'),
          ),
          h('div', { className: 'pt-row' },
            h('button', { className: 'pt-btn', onClick: exportLedger, disabled: busy }, '导出账本'),
            account.ledgerPath ? h('button', { className: 'pt-btn', onClick: copyLedgerPath, disabled: busy }, '复制路径') : null,
          ),
        ) : null,
        h('div', { className: 'pt-stats' },
          statCell('总权益', money(account.equity)),
          statCell('可用资金', money(account.cash)),
          statCell('保证金占用', money(account.margin)),
          statCell('风险度', pct(account.riskRatio), riskWarn ? 'pt-risk-high' : ''),
        ),
        error ? h('div', { className: 'pt-error', title: error.detail || undefined }, error.text) : null,
        notice ? h('div', { className: 'pt-note' }, notice) : null,
        tab === 'trade'
          ? h('div', { className: 'pt-workspace pt-workspace-futures' },
            h('div', { className: 'pt-main' }, tabBar, h('div', { className: 'pt-tab-body' }, tabBody)),
            h(FuturesContractRail, {
              contract,
              quote: displayQuote,
              limit: preview !== null ? preview.limit ?? null : null,
            }),
          )
          : h('div', { className: 'pt-main' }, tabBar, h('div', { className: 'pt-tab-body' }, tabBody)),
      )
    }

    /** Futures ticket: search picks the contract, direction is open/close × long/short. */
    function FuturesTradeTab({
      account, searchQuery, setSearchQuery, searchContracts, searching, contracts, contractNotice,
      contract, selectContract, form, setForm, quote, quoteNotice, preview, previewState, previewError, previewHint,
      busy, onSubmit, submitReason, receipt, positions, pending, onCancel, onClose,
    }) {
      const [book, setBook] = useState(() => (positions.length === 0 && pending.length > 0 ? 'orders' : 'positions'))
      const emptyPreview = previewHint !== ''
        ? previewHint
        : previewState === 'loading' ? '计算中…' : previewError !== '' ? previewError : '计算中…'
      return h('div', { className: 'pt-trade' },
        h('div', { className: 'pt-card pt-ticket-card' },
          h('div', { className: 'pt-row' },
            h('input', {
              className: 'pt-input', style: { flex: 1, minWidth: 180 }, value: searchQuery,
              placeholder: '合约代码/品种/中文名，例如 rb2611',
              onChange: event => setSearchQuery(event.target.value),
              onKeyDown: event => { if (event.key === 'Enter') void searchContracts() },
            }),
            h('button', { className: 'pt-btn', onClick: () => searchContracts(), disabled: searching }, searching ? '搜索中…' : '搜索'),
            h('button', { className: 'pt-btn', onClick: () => searchContracts(true), disabled: searching, title: '重新拉取合约列表' }, '刷新合约'),
          ),
          contracts === null
            ? h('div', { className: 'pt-note' }, contract !== null ? `已选 ${contract.symbol} ${contract.name ?? ''}` : '输入代码搜索合约')
            : contracts.length === 0
              ? h('div', { className: 'pt-empty' }, contractNotice || '没有匹配的合约')
              : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, maxHeight: 150, overflow: 'auto' } },
                contracts.map(item => h('button', {
                  key: item.symbol, className: 'pt-btn', 'data-active': contract !== null && contract.symbol === item.symbol,
                  style: { textAlign: 'left' },
                  onClick: () => selectContract(item),
                }, `${item.symbol} ${item.name ?? ''}`)),
              ),
          h('div', { className: 'pt-ticket' },
            h('div', { className: 'pt-ticket-form' },
              h(Field, { label: '合约', span: true },
                h('div', { className: 'pt-quote' },
                  contract !== null
                    ? h('span', null, `${contract.symbol} ${contract.name ?? ''}`)
                    : h('span', { className: 'pt-note' }, '尚未选择合约'),
                  quote !== null ? h('span', null, `最新 ${money(quote.last)}`) : null,
                  quote !== null && quote.marketTs ? h('span', { className: 'pt-note' }, `更新 ${clockTime(quote.marketTs)}`) : null,
                  quoteNotice !== '' ? h('span', { className: 'pt-note' }, quoteNotice) : null,
                ),
              ),
              h(Field, { label: '方向', span: true },
                h('div', { className: 'pt-seg' },
                  [['long', 'open', '开多'], ['short', 'open', '开空'], ['long', 'close', '平多'], ['short', 'close', '平空']].map(([side, offset, label]) =>
                    h('button', {
                      key: `${side}_${offset}`, 'data-active': form.side === side && form.offset === offset,
                      onClick: () => setForm(prev => ({ ...prev, side, offset })),
                    }, label),
                  ),
                ),
              ),
              h(Field, { label: '类型' }, h('div', { className: 'pt-seg' },
                [['market', '市价'], ['limit', '限价']].map(([key, label]) =>
                  h('button', { key, 'data-active': form.type === key, onClick: () => setForm(prev => ({ ...prev, type: key })) }, label)),
              )),
              h(Field, { label: '手数' }, h(DebouncedNumber, {
                value: form.qty, min: 1, step: 1,
                onChange: value => setForm(prev => ({ ...prev, qty: value })),
              })),
              form.type === 'limit'
                ? h(Field, { label: '限价' }, h(DebouncedNumber, {
                  value: form.limitPrice, min: 0, step: 0.01,
                  onChange: value => setForm(prev => ({ ...prev, limitPrice: value })),
                }))
                : form.offset === 'close'
                  ? h(Field, { label: '参考价（可选）' }, h(DebouncedNumber, {
                    value: form.price, min: 0, step: 0.01,
                    onChange: value => setForm(prev => ({ ...prev, price: value })),
                  }))
                  : h(Field, { label: '价格' }, h('div', { className: 'pt-note', style: { padding: '6px 0' } }, '按最新价成交')),
              h(Field, { label: '备注（复盘用）', span: true }, h('input', {
                className: 'pt-input', value: form.note, maxLength: 120,
                onChange: event => setForm(prev => ({ ...prev, note: event.target.value })),
              })),
            ),
            h('div', { className: 'pt-preview-pane' },
              h('div', { className: 'pt-card-title', style: { marginBottom: 6 } }, '预览'),
              preview !== null ? (preview.price > 0 ? h('div', { className: 'pt-preview' },
                previewRow('预估成交价', money(preview.price)),
                previewRow('合约价值', cents(preview.amountCents)),
                previewRow('保证金', cents(preview.marginCents)),
                previewRow('手续费', cents(preview.feesCents)),
                previewRow('成交后现金', cents(preview.cashAfterCents), preview.cashAfterCents < 0 ? 'pt-risk-high' : undefined),
                previewRow('风险度', pct(preview.riskRatioAfter), preview.riskRatioAfter >= (account.settings?.warnRiskRatio ?? 0.8) ? 'pt-risk-high' : undefined),
                form.offset === 'open'
                  ? previewRow('最多可开', `${count(preview.maxOpenQty)} 手`)
                  : previewRow('平仓可平', `${count(preview.availableCloseQty)} 手`),
                previewRow('涨停', preview.limit ? money(preview.limit.upper) : '—'),
                previewRow('跌停', preview.limit ? money(preview.limit.lower) : '—'),
                previewState === 'loading' ? h('div', { className: 'pt-note' }, '计算中…') : null,
                preview.warnings.length > 0 ? h('div', { className: 'pt-warn' }, preview.warnings.join('；')) : null,
                previewState === 'error' && previewError !== '' ? h('div', { className: 'pt-warn' }, previewError) : null,
              ) : h('div', { className: 'pt-empty' }, '没有可用行情，暂不可开仓')) : h('div', { className: 'pt-empty' }, emptyPreview),
            ),
          ),
          h('div', { className: 'pt-ticket-foot' },
            submitReason !== '' ? h('div', { className: 'pt-note' }, `不可提交：${submitReason}`) : null,
            h('button', {
              className: 'pt-btn pt-btn-primary pt-ticket-submit', onClick: onSubmit,
              title: submitReason || undefined,
              disabled: busy || submitReason !== '',
            }, directionText(form.side, form.offset)),
            h('div', { className: 'pt-ticket-meta' },
              h('span', { className: 'pt-note' },
                `可用 ${money(account.cash)} · 保证金 ${money(account.margin)} · 风险度 ${pct(account.riskRatio)}`),
            ),
            receipt ? h(FuturesReceiptLine, { receipt }) : null,
          ),
        ),
        h(FuturesBook, { positions, pending, book, setBook, busy, onCancel, onClose }),
      )
    }

    /** Persistent holdings/orders book under the futures ticket. */
    function FuturesBook({ positions, pending, book, setBook, busy, onCancel, onClose }) {
      const showPositions = book === 'positions'
      return h('div', { className: 'pt-card pt-trade-book' },
        h('div', { className: 'pt-book-head' },
          h('div', { className: 'pt-seg' },
            h('button', { 'data-active': showPositions, onClick: () => setBook('positions') }, `持仓 ${positions.length}`),
            h('button', { 'data-active': !showPositions, onClick: () => setBook('orders') }, `挂单 ${pending.length}`),
          ),
          h('div', { className: 'pt-note' }, showPositions ? '收盘按结算价盯市' : '未成交委托，可随时撤单'),
        ),
        h('div', { className: 'pt-book-scroll' },
          showPositions
            ? (positions.length === 0
              ? h('div', { className: 'pt-empty pt-book-empty' }, '无持仓 · 成交后自动显示')
              : h(Table, null,
                h('thead', null, h('tr', null,
                  ['合约', '方向', '手数', '今仓', '均价', '最新价', '浮盈亏'].map(label => h('th', { key: label }, label)),
                  h('th', null, '操作'),
                )),
                h('tbody', null, positions.map(position => h('tr', { key: `${position.symbol}-${position.side}` },
                  h('td', null, position.symbol),
                  h('td', null, FUTURES_SIDE_TEXT[position.side] ?? position.side),
                  h('td', null, count(position.qty)),
                  h('td', null, count(position.todayQty)),
                  h('td', null, money(position.avgPrice)),
                  h('td', null, money(position.lastPrice)),
                  h('td', { className: tone(position.unrealizedPnlCents ?? 0) }, cents(position.unrealizedPnlCents)),
                  h('td', null, h('button', {
                    className: 'pt-btn', onClick: () => onClose(position), disabled: !(position.qty > 0),
                  }, '平仓')),
                ))),
              ))
            : (pending.length === 0
              ? h('div', { className: 'pt-empty pt-book-empty' }, '无挂单 · 未成交的限价委托会停在这里')
              : h(Table, null,
                h('thead', null, h('tr', null,
                  ['合约', '方向', '类型', '手数', '限价', '状态'].map(label => h('th', { key: label }, label)),
                  h('th', null, '操作'),
                )),
                h('tbody', null, pending.map(order => h('tr', { key: order.id },
                  h('td', null, order.symbol),
                  h('td', null, directionText(order.side, order.offset)),
                  h('td', null, orderTypeText(order.type)),
                  h('td', null, count(order.qty)),
                  h('td', null, order.limitPrice === undefined ? '—' : money(order.limitPrice)),
                  h('td', null, FUTURES_STATUS_TEXT[order.status] ?? order.status),
                  h('td', null, h('button', { className: 'pt-btn', onClick: () => onCancel(order.id), disabled: busy }, '撤单')),
                ))),
              )),
        ),
      )
    }

    function FuturesReceiptLine({ receipt }) {
      if (receipt.failure !== undefined) {
        return h('div', { className: 'pt-receipt', 'data-state': 'rejected', title: receipt.failure.detail || undefined },
          `拒绝：${receipt.failure.text}`,
        )
      }
      const { order, cash } = receipt
      const direction = directionText(order.side, order.offset)
      if (order.status === 'rejected') {
        return h('div', { className: 'pt-receipt', 'data-state': 'rejected', title: order.reason || undefined },
          `拒绝：${direction} ${order.symbol} ${count(order.qty)} 手 · ${reasonText(order.reason, 'futures') || '未通过风控'}`,
        )
      }
      if (order.status === 'filled') {
        return h('div', { className: 'pt-receipt', 'data-state': 'filled', title: order.id },
          `成交：${direction} ${order.symbol} ${count(order.qty)} 手 · 价 ${money(order.fillPrice)} · 保证金 ${cents(order.marginCents)} · 费用 ${cents(order.feesCents)} · 成交后现金 ${money(cash)} · 单 ${order.id}`,
        )
      }
      return h('div', { className: 'pt-receipt', 'data-state': 'resting', title: order.id },
        `挂单：${direction} ${order.symbol} ${count(order.qty)} 手${order.limitPrice === undefined ? '' : ` @ ${money(order.limitPrice)}`} · 现价未穿越，成交前一直挂单 · 单 ${order.id}`,
      )
    }

    function FuturesPositionsTab({ positions, onClose }) {
      if (positions.length === 0) return h('div', { className: 'pt-empty' }, '无持仓 · 开仓成交后自动显示')
      return h(Table, null,
        h('thead', null, h('tr', null,
          ['合约', '方向', '手数', '今仓', '均价', '最新价', '浮盈亏', '保证金', '到期日'].map(label => h('th', { key: label }, label)),
          h('th', null, '操作'),
        )),
        h('tbody', null, positions.map(position => h('tr', { key: `${position.symbol}-${position.side}` },
          h('td', null, position.symbol),
          h('td', null, FUTURES_SIDE_TEXT[position.side] ?? position.side),
          h('td', null, count(position.qty)),
          h('td', null, count(position.todayQty)),
          h('td', null, money(position.avgPrice)),
          h('td', null, money(position.lastPrice)),
          h('td', { className: tone(position.unrealizedPnlCents ?? 0) }, cents(position.unrealizedPnlCents)),
          h('td', null, cents(position.marginCents)),
          h('td', null, position.deListDate ?? '—'),
          h('td', null, h('button', { className: 'pt-btn', onClick: () => onClose(position) }, '平仓')),
        ))),
      )
    }

    function FuturesOrdersTab({ pending, history, busy, onCancel }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', null,
          h('div', { className: 'pt-sub' }, '挂单'),
          pending.length === 0 ? h('div', { className: 'pt-empty' }, '无挂单') : h(Table, null,
            h('thead', null, h('tr', null,
              ['合约', '方向', '类型', '手数', '限价', '状态', '备注', '操作'].map(label => h('th', { key: label }, label)),
            )),
            h('tbody', null, pending.map(order => h('tr', { key: order.id },
              h('td', null, order.symbol),
              h('td', null, directionText(order.side, order.offset)),
              h('td', null, orderTypeText(order.type)),
              h('td', null, count(order.qty)),
              h('td', null, order.limitPrice === undefined ? '—' : money(order.limitPrice)),
              h('td', null, FUTURES_STATUS_TEXT[order.status] ?? order.status),
              h('td', { title: order.note ?? undefined }, order.note === undefined ? '' : h('span', { className: 'pt-note-cell' }, order.note)),
              h('td', null, h('button', { className: 'pt-btn', onClick: () => onCancel(order.id), disabled: busy }, '撤单')),
            ))),
          ),
          pending.some(order => order.status === 'queued')
            ? h('div', { className: 'pt-note' }, '「排队」：当前时段不撮合，下一交易时段会尝试成交，可随时撤单。')
            : null,
        ),
        h('div', null,
          h('div', { className: 'pt-sub' }, '历史'),
          history.length === 0 ? h('div', { className: 'pt-empty' }, '无历史订单') : h(Table, null,
            h('thead', null, h('tr', null,
              ['时间', '合约', '方向', '类型', '手数', '限价', '状态', '成交价', '原因', '备注'].map(label => h('th', { key: label }, label)),
            )),
            h('tbody', null, history.slice(0, 30).map(order => h('tr', { key: order.id },
              h('td', null, dateTime(order.createdAt)),
              h('td', null, order.symbol),
              h('td', null, directionText(order.side, order.offset)),
              h('td', null, orderTypeText(order.type)),
              h('td', null, count(order.qty)),
              h('td', null, order.limitPrice === undefined ? '—' : money(order.limitPrice)),
              h('td', null, FUTURES_STATUS_TEXT[order.status] ?? order.status),
              h('td', null, order.fillPrice === undefined ? '—' : money(order.fillPrice)),
              h('td', { title: order.reason ?? undefined }, reasonText(order.reason, 'futures')),
              h('td', { title: order.note ?? undefined }, order.note === undefined ? '' : h('span', { className: 'pt-note-cell' }, order.note)),
            ))),
          ),
          history.length > 30 ? h('div', { className: 'pt-note' }, `仅显示最近 30 条，共 ${history.length} 条`) : null,
        ),
      )
    }

    function FuturesReviewTab({ review, period, setPeriod }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'pt-row' }, PERIODS.map(([key, label]) =>
          h('button', { key, className: 'pt-btn', 'data-active': period === key, onClick: () => setPeriod(key) }, label),
        )),
        review !== null ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { className: 'pt-stats' },
            statCell('成交笔数', count(review.tradeCount)),
            statCell('已实现盈亏', signed(review.realizedPnl), tone(review.realizedPnl)),
            statCell('费用合计', money(review.totalFees)),
            statCell('最大回撤', pct(review.maxDrawdownPct)),
          ),
          h('div', { className: 'pt-note' },
            `开仓 ${count(review.openCount)} 笔 · 平仓 ${count(review.closeCount)} 笔 · 盈利 ${count(review.winCount)} 笔 · 亏损 ${count(review.lossCount)} 笔`),
          h('div', { className: 'pt-chart-wrap' }, h(EquityChart, { points: review.equityCurve })),
          h('div', null,
            h('div', { className: 'pt-sub' }, '分品种统计'),
            review.byProduct.length === 0 ? h('div', { className: 'pt-empty' }, '暂无成交') : h(Table, null,
              h('thead', null, h('tr', null,
                ['品种', '成交笔数', '已实现盈亏'].map(label => h('th', { key: label }, label)),
              )),
              h('tbody', null, review.byProduct.map(item => h('tr', { key: item.product },
                h('td', null, String(item.product ?? '').toUpperCase()),
                h('td', null, count(item.tradeCount)),
                h('td', { className: tone(item.realizedPnl) }, signed(item.realizedPnl)),
              ))),
            ),
          ),
        ) : h('div', { className: 'pt-empty' }, '加载复盘…'),
      )
    }

    /** Right rail for the futures ticket: static terms plus the marked quote. */
    function FuturesContractRail({ contract, quote, limit }) {
      return h('aside', { className: 'pt-futures-rail', 'aria-label': '合约要素' },
        h('div', { className: 'pt-card' },
          h('div', { className: 'pt-card-title' }, '合约要素'),
          contract === null
            ? h('div', { className: 'pt-empty' }, '搜索并选择合约')
            : h('div', { className: 'pt-preview' },
              previewRow('合约', contract.symbol),
              previewRow('名称', contract.name ?? '—'),
              previewRow('交易所', contract.exchange ?? '—'),
              previewRow('品种', contract.product ?? '—'),
              previewRow('乘数', contract.multiplier === undefined ? '—' : count(contract.multiplier)),
              previewRow('最小变动', money(contract.tickSize)),
              previewRow('保证金率', pct(contract.marginRate)),
              previewRow('到期日', contract.deListDate ?? '—'),
              previewRow('涨停', limit === null ? '—' : money(limit.upper)),
              previewRow('跌停', limit === null ? '—' : money(limit.lower)),
              previewRow('最新价', quote === null ? '—' : money(quote.last),
                quote !== null && quote.preSettlement !== undefined && quote.last !== quote.preSettlement
                  ? (quote.last > quote.preSettlement ? 'pt-up' : 'pt-down')
                  : undefined),
              previewRow('昨结', quote === null || quote.preSettlement === undefined ? '—' : money(quote.preSettlement)),
            ),
        ),
      )
    }

    /* ---------------------------------------------------------- dashboard -- */

    /**
     * Top-level shell: the account switch lives above both dashboards, so the
     * stock half keeps its exact layout and the futures half mounts on demand.
     */
    function Dashboard({ renderSlot } = {}) {
      const [accountMode, setAccountMode] = useState('stock')
      const accountSwitch = h(AccountSwitch, { mode: accountMode, onChange: setAccountMode })
      return h('div', { className: 'pt-root' },
        h('style', null, CSS),
        accountMode === 'futures'
          ? h(FuturesDashboard, { accountSwitch })
          : h(StockDashboard, { renderSlot, accountSwitch }),
      )
    }

    function StockDashboard({ renderSlot, accountSwitch }) {
      const [account, setAccount] = useState(null)
      const [orders, setOrders] = useState([])
      const [trades, setTrades] = useState([])
      const [review, setReview] = useState(null)
      const [period, setPeriod] = useState('30d')
      const [tab, setTab] = useState('trade')
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState(false)
      const [resetNonce, setResetNonce] = useState(0)
      const submitting = useRef(false)
      const placeKey = useRef({ key: '', id: '' })
      const [preview, setPreview] = useState(null)
      const [previewState, setPreviewState] = useState('idle')
      const [previewError, setPreviewError] = useState('')
      const [previewNonce, setPreviewNonce] = useState(0)
      const [quoteError, setQuoteError] = useState('')
      // Quote for an unfinished draft (symbol known, qty/limit still missing).
      // A complete draft gets its quote from the preview response instead.
      const [symbolQuote, setSymbolQuote] = useState(null)
      const [receipt, setReceipt] = useState(null)
      const [session, setSession] = useState(null)
      const [searchQuery, setSearchQuery] = useState('')
      const [searchHits, setSearchHits] = useState([])
      const [searchAttempted, setSearchAttempted] = useState(false)
      const [marketList, setMarketList] = useState(null)
      const [marketBoard, setMarketBoard] = useState('main')
      const [bars, setBars] = useState([])
      const [barError, setBarError] = useState('')
      const barsSeq = useRef(0)
      const [barInterval, setBarInterval] = useState('day')
      const [daily, setDaily] = useState([])
      const [cashFlow, setCashFlow] = useState([])
      const [trips, setTrips] = useState([])
      const [watchlist, setWatchlist] = useState([])
      // Read/write the favourites through a ref so two clicks in one task see
      // each other's optimistic change instead of both computing from stale
      // state (which silently dropped the first symbol).
      const watchRef = useRef([])
      const watchSeq = useRef(0)
      const searchSeq = useRef(0)
      const marketSeq = useRef(0)
      useEffect(() => { watchRef.current = watchlist }, [watchlist])
      const [watchOnly, setWatchOnly] = useState(false)
      const [form, setForm] = useState({
        symbol: '600519',
        side: 'buy',
        type: 'market',
        qty: '',
        limitPrice: '',
        price: '',
        note: '',
      })

      const alive = useRef(true)
      const loadAllSeq = useRef(0)
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
      }, [])

      const formSymbol = useRef(form.symbol)
      useEffect(() => { formSymbol.current = form.symbol }, [form.symbol])

      const loadAll = useCallback(async (quiet = false) => {
        const seq = ++loadAllSeq.current
        try {
          const [nextAccount, nextOrders, nextTrades, nextReview, nextSession] = await Promise.all([
            rpc('account/get'),
            rpc('list/orders'),
            rpc('list/trades'),
            rpc('review/get', { period }),
            rpc('market/status'),
          ])
          if (!alive.current) return null
          // A poll started before a period switch carries the old review;
          // newer requests own the page state, but callers still get their own
          // snapshot (order receipts need the fresh cash).
          if (seq === loadAllSeq.current) {
            setAccount(nextAccount)
            setOrders(nextOrders)
            setTrades(nextTrades)
            setReview(nextReview)
            setSession(nextSession)
            if (!quiet) setError(null)
          }
          return { account: nextAccount, orders: nextOrders, trades: nextTrades }
        } catch (cause) {
          if (alive.current && seq === loadAllSeq.current) setError(errorOf(cause))
          return null
        }
      }, [period])

      const loadReviewDetail = useCallback(async () => {
        try {
          const [nextDaily, nextCash, nextTrips] = await Promise.all([
            rpc('review/daily'),
            rpc('cash/flow'),
            rpc('review/roundtrips'),
          ])
          if (!alive.current) return
          setDaily(nextDaily)
          setCashFlow(nextCash)
          setTrips(nextTrips)
        } catch (cause) {
          if (alive.current) setError(errorOf(cause))
        }
      }, [])

      useEffect(() => { loadAll() }, [loadAll])

      const tick = useCallback(async () => {
        try {
          const result = await rpc('tick')
          if (!alive.current) return
          if (result.filled.length > 0) setNotice(`成交 ${result.filled.length} 笔`)
          if (result.notices.length > 0) setNotice(result.notices.join('；'))
          await loadAll(true)
          // Re-price the open ticket: the quote strip and preview otherwise
          // froze at the moment the symbol was entered. An unfinished draft
          // only fetches the quote, so clear its dedupe key too.
          if (alive.current) {
            quoteSymbol.current = ''
            setPreviewNonce(value => value + 1)
          }
        } catch {
          // Polling failures stay silent; the manual refresh shows the error.
        }
      }, [loadAll])

      // The host scheduler is the primary matcher; this stays as a live extra
      // trigger while the panel is visible.
      useEffect(() => {
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') tick()
        }, 5000)
        return () => clearInterval(timer)
      }, [tick])

      const loadBars = useCallback(async (symbol = form.symbol) => {
        const seq = ++barsSeq.current
        if (symbol.trim().length < 6) {
          // Do not leave the previous symbol's candles under a new title.
          if (alive.current) { setBars([]); setBarError('') }
          return
        }
        try {
          const result = await rpc('market/bars', { symbol: symbol.trim(), interval: barInterval, limit: 80 })
          if (!alive.current || seq !== barsSeq.current) return
          if (result.state === 'ok') {
            setBars(result.bars ?? [])
            setBarError('')
          } else {
            setBars([])
            setBarError(result.notice ?? 'K 线数据暂不可用')
          }
        } catch (cause) {
          if (!alive.current || seq !== barsSeq.current) return
          setBars([])
          setBarError('K 线数据暂不可用')
          setError(errorOf(cause))
        }
      }, [form.symbol, barInterval])

      const runSearch = useCallback(async () => {
        if (!searchQuery.trim()) { setSearchAttempted(false); return }
        setSearchAttempted(true)
        const seq = ++searchSeq.current
        try {
          const hits = await rpc('market/search', { query: searchQuery.trim(), limit: 12 })
          if (alive.current && seq === searchSeq.current) setSearchHits(hits)
        } catch (cause) {
          if (alive.current && seq === searchSeq.current) setError(errorOf(cause))
        }
      }, [searchQuery])

      const loadMarket = useCallback(async (page = 1) => {
        const seq = ++marketSeq.current
        try {
          const next = await rpc('market/list', { board: marketBoard, page, pageSize: 50 })
          if (alive.current && seq === marketSeq.current) setMarketList(next)
        } catch (cause) {
          if (alive.current && seq === marketSeq.current) setError(errorOf(cause))
        }
      }, [marketBoard])

      /**
       * Only a real K-line selection may rewrite the ticket. dsh_kline calls
       * `onIdentity` on its own during mount/route changes, so an unchanged
       * symbol must not pop "已从 K 线选择 …" over the user's real feedback.
       */
      const klineIdentity = useCallback((symbol, name) => {
        const next = bareSymbol(symbol)
        if (!next || next === bareSymbol(formSymbol.current)) return
        formSymbol.current = next
        setForm(prev => ({ ...prev, symbol: next }))
        setNotice(name ? `已从 K 线选择 ${name}` : '')
      }, [])

      useEffect(() => { void loadBars() }, [loadBars])

      useEffect(() => {
        if (tab === 'review') void loadReviewDetail()
      }, [tab, loadReviewDetail])

      useEffect(() => {
        if (tab === 'market') {
          void loadMarket(1)
          rpc('watchlist/get').then(result => { if (alive.current) setWatchlist(result.symbols ?? []) }).catch(() => {})
        }
      }, [tab, marketBoard, loadMarket])

      const isWatched = useCallback(symbol => watched(watchlist, symbol), [watchlist])

      const toggleWatch = useCallback(async (symbol) => {
        const code = bareSymbol(symbol)
        // Store the bare 6-digit code so a search hit (`600519.SH`) and a list
        // row (`600519.XSHG`) point at the same favourite.
        const current = watchRef.current
        const next = current.some(item => bareSymbol(item) === code)
          ? current.filter(item => bareSymbol(item) !== code)
          : [...current, code]
        watchRef.current = next
        setWatchlist(next)
        const seq = ++watchSeq.current
        try {
          const result = await rpc('watchlist/set', { symbols: next })
          if (!alive.current || seq !== watchSeq.current) return
          watchRef.current = result.symbols ?? next
          setWatchlist(result.symbols ?? next)
        } catch (cause) {
          if (!alive.current) return
          setError(errorOf(cause))
          // The server is the source of truth after a failed write.
          try {
            const fresh = await rpc('watchlist/get')
            if (alive.current && seq === watchSeq.current) {
              watchRef.current = fresh.symbols ?? []
              setWatchlist(fresh.symbols ?? [])
            }
          } catch { /* keep the optimistic state */ }
        }
      }, [])

      const adoptQuote = useCallback(symbol => {
        const next = bareSymbol(symbol)
        formSymbol.current = next
        setForm(prev => ({ ...prev, symbol: next }))
        setTab('trade')
      }, [])

      const draft = useCallback(() => ({
        symbol: form.symbol.trim(),
        side: form.side,
        type: form.type,
        qty: Number(form.qty),
        limitPrice: form.type === 'limit' ? Number(form.limitPrice) : undefined,
        price: form.type === 'market' && form.price !== '' ? Number(form.price) : undefined,
        note: form.note.trim() === '' ? undefined : form.note.trim(),
      }), [form])

      // The note is not part of the preview: only the trading fields are.
      const previewDraft = useCallback(() => ({
        symbol: form.symbol.trim(),
        side: form.side,
        type: form.type,
        qty: Number(form.qty),
        limitPrice: form.type === 'limit' ? Number(form.limitPrice) : undefined,
        price: form.type === 'market' && form.price !== '' ? Number(form.price) : undefined,
      }), [form.symbol, form.side, form.type, form.qty, form.limitPrice, form.price])

      const previewSymbol = useRef('')
      const previewSeq = useRef(0)
      // Symbols whose quote the blocked-preview path already asked for.
      const quoteSymbol = useRef('')

      // One preview per input change, debounced; the response carries the quote,
      // so a complete draft still costs a single request. While the draft is
      // unfinished the price line asks for the quote alone — a limit order
      // whose limit is still being typed must show what the stock costs.
      useEffect(() => {
        const current = previewDraft()
        previewSeq.current += 1
        const seq = previewSeq.current
        if (previewBlockReason(current) !== '') {
          previewSymbol.current = ''
          setPreview(null)
          setPreviewState('idle')
          setPreviewError('')
          if (current.symbol.length < 6) {
            quoteSymbol.current = ''
            setSymbolQuote(null)
            setQuoteError('')
            return
          }
          if (quoteSymbol.current === current.symbol) return
          const timer = setTimeout(() => {
            rpc('market/quote', { symbols: [current.symbol] })
              .then(result => {
                if (!alive.current || seq !== previewSeq.current) return
                const found = result.quotes[0] ?? null
                quoteSymbol.current = found === null ? '' : current.symbol
                setSymbolQuote(found)
                setQuoteError(found ? '' : (result.notice ?? '没有查到行情'))
              })
              .catch(cause => {
                if (!alive.current || seq !== previewSeq.current) return
                quoteSymbol.current = ''
                setSymbolQuote(null)
                setQuoteError(errorOf(cause).text)
              })
          }, 300)
          return () => clearTimeout(timer)
        }
        quoteSymbol.current = current.symbol
        if (previewSymbol.current !== current.symbol) {
          previewSymbol.current = current.symbol
          setPreview(null)
        }
        setPreviewState('loading')
        const timer = setTimeout(() => {
          rpc('order/preview', current)
            .then(result => {
              if (!alive.current || seq !== previewSeq.current) return
              setPreview(result)
              // Keep the quote for an unfinished draft: switching to 限价 must
              // not blank the price line while the limit is still being typed.
              if (result.quote) setSymbolQuote(result.quote)
              setPreviewError('')
              setPreviewState('ready')
            })
            .catch(cause => {
              if (!alive.current || seq !== previewSeq.current) return
              setPreviewError(errorOf(cause).text)
              setPreviewState('error')
            })
        }, 300)
        return () => clearTimeout(timer)
      }, [previewDraft, previewNonce])

      const doSubmit = useCallback(async () => {
        if (submitting.current) return
        submitting.current = true
        setBusy(true)
        setReceipt(null)
        try {
          const current = draft()
          const key = JSON.stringify(current)
          if (placeKey.current.key !== key) {
            placeKey.current = {
              key,
              id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            }
          }
          const order = await rpc('order/place', { draft: current, requestId: placeKey.current.id })
          const snapshot = await loadAll(true)
          const fill = snapshot === null ? undefined : snapshot.trades.find(item => item.orderId === order.id)
          setReceipt({ order, fill, cash: snapshot === null ? undefined : snapshot.account.cash })
          placeKey.current = { key: '', id: '' }
          // Keep the card's numbers; recompute them against the new cash.
          setPreviewNonce(value => value + 1)
        } catch (cause) {
          setReceipt({ failure: errorOf(cause) })
        } finally {
          submitting.current = false
          setBusy(false)
        }
      }, [draft, loadAll])

      const cancel = useCallback(async orderId => {
        setBusy(true)
        try {
          await rpc('order/cancel', { orderId })
          await loadAll(true)
        } catch (cause) {
          setError(errorOf(cause))
        } finally {
          setBusy(false)
        }
      }, [loadAll])

      const copyLedgerPath = useCallback(async () => {
        const path = account !== null ? account.ledgerPath : undefined
        if (path === undefined) return
        const copied = typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText
          ? await navigator.clipboard.writeText(path).then(() => true, () => false)
          : false
        setNotice(copied ? `已复制账本路径：${path}` : `账本路径：${path}`)
      }, [account])

      const exportLedger = useCallback(async () => {
        try {
          const result = await rpc('account/export')
          if (!result.exists || !result.content) {
            setNotice(result.notice ?? '账本文件尚未创建')
            return
          }
          if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
            const blob = new Blob([result.content], { type: 'application/x-ndjson' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = 'paper-trading-events.jsonl'
            link.click()
            URL.revokeObjectURL(url)
          }
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(result.path).catch(() => {})
          }
          setNotice(`已导出账本：${result.path}`)
        } catch (cause) {
          setError(errorOf(cause))
        }
      }, [])

      const reset = useCallback(async () => {
        if (!window.confirm('重置模拟交易账户？持仓与挂单会清空。')) return
        setBusy(true)
        try {
          setAccount(await rpc('account/reset', { confirm: true }))
          setPreview(null)
          setReceipt(null)
          await loadAll(true)
          await loadReviewDetail()
          setPreviewNonce(value => value + 1)
          setResetNonce(value => value + 1)
          setNotice('账户已重置')
        } catch (cause) {
          setError(errorOf(cause))
        } finally {
          setBusy(false)
        }
      }, [loadAll, loadReviewDetail])

      /** Header refresh: account/orders/trades/review plus one fresh preview. */
      const refreshAll = useCallback(async () => {
        setBusy(true)
        try {
          await loadAll()
          if (tab === 'review') await loadReviewDetail()
          // 刷新 must also retry the current tab's own fetch, not just the
          // account bundle: a failed market list otherwise stays broken.
          if (tab === 'market') await loadMarket(marketList?.page ?? 1)
          // Force the incomplete-draft quote branch to fetch again even when
          // the symbol did not change (a transient quote failure is retryable).
          quoteSymbol.current = ''
          setPreviewNonce(value => value + 1)
        } finally {
          setBusy(false)
        }
      }, [loadAll, loadReviewDetail, tab, loadMarket, marketList?.page])

      /** Only real blockers disable submit; a failed preview never does. */
      /** Read the flag outside the deps array: `account` is null on the first render. */
      const blocked = account?.blocked === true
      const quote = preview ? preview.quote ?? null : symbolQuote
      const submitReason = useMemo(() => {
        if (account === null) return '加载账户中'
        if (blocked) return '账户已锁定'
        const symbol = form.symbol.trim()
        if (symbol.length < 6) return '输入 6 位代码'
        if (String(form.qty).trim() === '') return '填写数量'
        const qty = Number(form.qty)
        if (!Number.isInteger(qty) || qty <= 0) return '数量需为正整数'
        if (form.side === 'buy' && qty % 100 !== 0) return '买入需 100 股整数倍'
        if (form.type === 'limit' && !(Number(form.limitPrice) > 0)) return '填写限价'
        if (session !== null && session.phase === 'auction_close') return '收盘竞价暂不支持模拟撮合'
        if (form.type === 'market' && session !== null && !session.canMatch) return '当前时段不能市价成交'
        if (form.type === 'market' && quote === null && !(Number(form.price) > 0)) return '无行情，请填参考价'
        if (preview !== null && preview.quote?.status === 'suspended') return '停牌'
        if (preview !== null && form.type === 'limit' && preview.priceLimit !== undefined) {
          const price = Number(form.limitPrice)
          if (price < preview.priceLimit.lower || price > preview.priceLimit.upper) return '价格超出涨跌停'
        }
        if (form.side === 'buy' && preview !== null && preview.cashAfterCents < 0) return '资金不足'
        if (form.side === 'sell' && preview !== null && qty > preview.availableQty) return '可卖不足'
        return ''
      }, [blocked, form, session, quote, preview])
      const pending = useMemo(() => orders.filter(order => order.status === 'pending' || order.status === 'queued' || order.status === 'partially_filled'), [orders])
      const history = useMemo(() => orders.filter(order => order.status !== 'pending' && order.status !== 'queued' && order.status !== 'partially_filled'), [orders])
      const positions = account?.positions ?? []

      /** Selling from a book only fills the ticket; the user still confirms. */
      const sellPosition = useCallback(position => {
        formSymbol.current = position.symbol
        setForm(prev => ({ ...prev, symbol: position.symbol, side: 'sell', type: 'market', qty: String(Math.min(position.available, position.qty)) }))
        setTab('trade')
      }, [])

      if (account === null) {
        return h('div', { className: 'pt-inner' },
          h('div', { className: 'pt-head' },
            h('div', null, h('h3', { className: 'pt-title' }, '模拟交易')),
            h('div', { className: 'pt-row' }, accountSwitch,
              h('button', { className: 'pt-btn', onClick: () => { setError(null); void loadAll() } }, '重试'),
            ),
          ),
          error
            ? h('div', { className: 'pt-error', title: error.detail || undefined }, error.text)
            : h('div', { className: 'pt-empty' }, '加载模拟交易…'),
        )
      }

      return h('div', { className: 'pt-inner' },
        h('div', { className: 'pt-head' },
            h('div', null,
              h('h3', { className: 'pt-title' }, '模拟交易'),
              h('div', { className: 'pt-sub' },
                `${tradeDateText(account.tradeDate)} · ${session ? PHASE_TEXT[session.phase] : '时段未知'} · 初始 ${money(account.initialCash)} · ${account.blocked ? '已锁定' : '运行中'}`,
                sessionNote(session) !== '' ? h('span', { className: 'pt-note' }, sessionNote(session)) : null,
              ),
            ),
            h('div', { className: 'pt-row' },
              accountSwitch,
              h('button', { className: 'pt-btn', onClick: refreshAll, disabled: busy }, '刷新'),
              h('button', { className: 'pt-btn pt-btn-danger', onClick: reset, disabled: busy }, '重置'),
            ),
          ),
          account.blocked ? h('div', { className: 'pt-blocked' },
            h('div', { className: 'pt-blocked-text' },
              h('div', null, '账本校验失败，账户已锁定。'),
              account.blockedReason ? h('div', { className: 'pt-blocked-detail', title: account.blockedReason }, `原因：${account.blockedReason}`) : null,
              account.ledgerPath ? h('div', { className: 'pt-blocked-detail', title: account.ledgerPath }, `账本：${account.ledgerPath}`) : null,
              h('div', { className: 'pt-blocked-hint' }, '修复后需完全退出并重开 DSH；重置会先备份。'),
            ),
            h('div', { className: 'pt-row' },
              h('button', { className: 'pt-btn', onClick: exportLedger, disabled: busy }, '导出账本'),
              account.ledgerPath ? h('button', { className: 'pt-btn', onClick: copyLedgerPath, disabled: busy }, '复制路径') : null,
            ),
          ) : null,
          h('div', { className: 'pt-stats' },
            h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '总资产'), h('div', { className: 'pt-stat-value' }, money(account.equity))),
            h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '可用现金'), h('div', { className: 'pt-stat-value' }, money(account.cash))),
            h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '累计盈亏'), h('div', { className: `pt-stat-value ${tone(account.pnl)}` }, signed(account.pnl))),
            h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '今日盈亏'), h('div', { className: `pt-stat-value ${tone(account.todayPnl)}` }, signed(account.todayPnl))),
          ),
          error ? h('div', { className: 'pt-error', title: error.detail || undefined }, error.text) : null,
          notice ? h('div', { className: 'pt-note' }, notice) : null,
          h('div', { className: 'pt-workspace' },
            h('div', { className: 'pt-main' },
              h('div', { className: 'pt-tabs' },
                [['trade', '交易'], ['basket', '一揽子'], ['market', '行情'], ['positions', `持仓 ${positions.length}`], ['orders', `订单 ${pending.length}`], ['review', '复盘']].map(([key, label]) =>
                  h('button', { key, className: 'pt-tab', 'data-active': tab === key, onClick: () => setTab(key) }, label),
                ),
              ),
              h('div', { className: 'pt-tab-body' },
                tab === 'trade' ? h(TradeTab, {
                  account, form, setForm, quote, quoteError, preview, previewState, previewError,
                  previewHint: previewBlockReason(previewDraft()),
                  busy,
                  onSubmit: doSubmit,
                  submitReason,
                  receipt,
                  positions, pending,
                  onCancel: cancel,
                  onSell: sellPosition,
                }) : null,
                tab === 'basket' ? h(BasketTab, { account, onDone: refreshAll, resetNonce }) : null,
                tab === 'market' ? h(MarketTab, {
                  searchQuery,
                  setSearchQuery: value => { setSearchQuery(value); setSearchAttempted(false) },
                  runSearch, searchHits, searchAttempted, watchlist, isWatched, toggleWatch,
                  marketList, marketBoard, setMarketBoard, watchOnly, setWatchOnly, loadMarket, busy, adoptQuote, session,
                }) : null,
                tab === 'positions' ? h(PositionsTab, {
                  positions,
                  onSell: sellPosition,
                }) : null,
                tab === 'orders' ? h(OrdersTab, { pending, history, busy, onCancel: cancel }) : null,
                tab === 'review' ? h(ReviewTab, {
                  review, period,
                  setPeriod: key => setPeriod(key),
                  trades, daily, cashFlow, trips,
                }) : null,
              ),
            ),
            h(KlinePane, {
              renderSlot,
              symbol: form.symbol,
              quote,
              bars,
              error: barError,
              interval: barInterval,
              onInterval: setBarInterval,
              onRefresh: () => loadBars(),
              onIdentity: klineIdentity,
            }),
          ),
      )
    }

    const PANEL_ID = 'ft-paper-trading'

    /** Candlestick glyph; the sidebar owns the button, label and tooltip. */
    function PaperGlyph({ size }) {
      const edge = Number(size) > 0 ? Number(size) : 16
      return h('svg', {
        width: edge, height: edge, viewBox: '0 0 16 16', 'aria-hidden': 'true',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round',
      },
        h('path', { d: 'M2 13.5V10M5.5 13.5V6M9 13.5V8.5M12.5 13.5V3.5' }),
        h('path', { d: 'M1.5 2.5h13', opacity: 0.35 }),
      )
    }

    function apply(ctx) {
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 30,
        label: '模拟交易',
      }, PaperGlyph))
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        children: {
          'paperTrading.kline': { kind: 'single', scope: 'root' },
        },
      }, Dashboard))
    }

    const inject = ['slots']
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
