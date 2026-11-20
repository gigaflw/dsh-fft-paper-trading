/* 10 · runtime — endpoint, formatting, vocabularies, storage keys, banner model. */

    const ROUTE = '/api/ft-paper-trading'
    /** Release number stamped into the Feedback link title at build time. */
    const PAPER_VERSION = '__PAPER_VERSION__'
    /** Public repository; the panel links out and collects nothing itself. */
    const ISSUE_NEW = 'https://github.com/gigaflw/dsh-fft-paper-trading/issues/new'
    /**
     * Feedback opens the Bug form with the release already in the title: a
     * report without a version costs triage a round trip. GitHub honours only
     * `title`/`labels` on a form URL — a `body` param is ignored (and a blank
     * issue can 400 on repos that disable it) — so the body stays user-written.
     */
    const FEEDBACK_URL = `${ISSUE_NEW}?template=bug_report.yml&title=${encodeURIComponent(`[Bug] v${PAPER_VERSION} `)}`
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
    const tradeDateText = (value, estimated = false) => {
      if (!value) return '—'
      return value > shanghaiToday()
        ? `下一交易日${estimated ? '（按工作日估算）' : ''} ${value}`
        : value
    }
    /**
     * Trading-day source note for the header subtitle. Only rendered while the
     * weekday fallback is in use, so the normal state stays quiet.
     */
    const calendarNote = calendar => {
      if (calendar === null || calendar === undefined || calendar.source !== 'fallback') return null
      const detail = calendar.reason === undefined ? '' : `（${calendar.reason}）`
      return h('span', {
        className: 'pt-note',
        title: `交易日历降级：按周一至周五估算，节假日会被当作交易日，影响 T+1 可卖、挂单过期、期货结算与下一交易日${detail}`,
      }, ' · 交易日历降级（按工作日估算）')
    }
    /** Canonical ids arrive from the host; the raw input keeps whatever was typed. */
    const halfWidthDigits = value => String(value ?? '')
      .replace(/[０-９]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
      .replace(/[Ａ-Ｚ]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
    // dsh_kline hands over its own suffixes (`600519.XSHG`, `000001.XSHE`); the
    // ticket shows the canonical `.SH` / `.SZ` form and the host accepts both.
    const HOST_EXCHANGES = { XSHG: 'SH', XSHE: 'SZ', BJSE: 'BJ' }
    const foldHostSymbol = value => {
      const text = halfWidthDigits(value).toUpperCase().trim()
      const suffix = /^(\d{6})\.([A-Z]{2,4})$/.exec(text)
      if (suffix === null) return text
      const exchange = HOST_EXCHANGES[suffix[2]]
      return exchange === undefined ? text : `${suffix[1]}.${exchange}`
    }
    // The ticket accepts `600519`, `600519.SH`, `600519.XSHG` and `SH600519`;
    // the host folds them into one canonical id, so the panel keeps letters.
    const symbolInput = value => {
      const text = foldHostSymbol(value).replace(/[^0-9A-Z.]/g, '').slice(0, 12)
      const prefix = /^(SH|SZ|BJ)(\d{6})$/.exec(text)
      return prefix === null ? text : `${prefix[2]}.${prefix[1]}`
    }
    const budgetInput = value => halfWidthDigits(value).replace(/[,，\s]/g, '')
    const symbolText = quote => [quote?.symbol, quote?.name].filter(text => text).join(' ')
    /**
     * Quote origin in human terms; the raw interface name is too technical.
     * A daily-bar quote is the free-tier fallback (last close), never a live
     * tick, so the label has to say which one it is.
     */
    const quoteSourceText = quote => {
      if (!quote || !quote.source) return 'FTShare'
      if (quote.source === 'manual') return '参考价'
      // Provenance, not tier: a keyed account can also end up on the daily close.
      if (quote.source === 'daily-bar') return '日K收盘'
      return 'FTShare 实时'
    }
    /**
     * Quote line time. Same-day data shows the clock only; a daily-close quote
     * (free tier) or any older timestamp carries its date, so yesterday's
     * close cannot read as today's live price.
     */
    const quoteUpdateText = quote => {
      if (!quote) return ''
      if (quote.source === 'manual') return '手动价'
      const ts = quote.marketTs
      if (ts === undefined || ts === null) return '更新 —'
      const date = dateFormat.format(new Date(ts))
      return date === shanghaiToday() ? `更新 ${clockTime(ts)}` : `更新 ${date.slice(5)} ${clockTime(ts)}`
    }
    /**
     * How often the open ticket should re-price itself. A live quote deserves
     * the 5 s beat; a daily-bar (free tier) or missing one does not, and on the
     * anonymous quota the 5 s re-preview alone would spend the day's budget.
     */
    const ticketRefreshInterval = quote =>
      quote === null || quote === undefined || quote.source === 'daily-bar' ? 300_000 : 5_000
    /**
     * Header badge copy for the four data-source states. The badge answers
     * "is an FTShare key configured" without ever showing the key itself; the
     * title carries the consequence (realtime vs daily-close pricing).
     */
    const DATA_SOURCE_STATE = {
      configured: { text: '数据源正常', title: 'FTShare API Key 已配置，可看实时行情' },
      free: {
        text: '免费数据源',
        title: '未配置 FTShare Key：免费档报价取日K收盘，可手填参考价交易',
      },
      none: { text: '无数据源', title: '未安装 FTShare 数据服务，行情不可用；可手填参考价交易' },
      invalid: { text: '数据源无效', title: 'FTShare Key 无法使用；请在「设置」中检查，可手填参考价交易' },
    }
    /** Badge suffix per recorded failure, so the header cannot read 正常 while quotes fail. */
    const DATA_PROBLEM_STATE = {
      'no-key': '未配置 Key',
      'invalid-key': 'Key 无效',
      'plan-denied': '套餐未开通',
      quota: '额度用尽',
      network: '上游超时',
      upstream: '上游异常',
    }
    /**
     * Where a missing or rejected key gets fixed.
     *
     * The banner does not link out: the settings section already carries the
     * signup link in its 访问凭据 card, and the host exposes no client API that
     * opens settings from here, so the copy names the section instead of sending
     * the user to a second, differently-worded URL.
     */
    const KEY_SETTINGS = '设置 → 金融终端'
    /** One reason per stored value, so a new problem shows again after a dismissal. */
    const DATA_BANNER_DISMISS_KEY = 'paper-trading:data-banner-dismissed'

    /**
     * Model for the data banner.
     *
     * Order matters: a missing service beats any recorded failure (nothing can
     * work), a spent quota beats the plain "no key" hint (it explains why行情
     * stopped), and a runtime key rejection beats the configured badge.
     */
    function bannerModel(status) {
      if (status === null || status === undefined) return null
      if (status.state === 'none') {
        return {
          id: 'no-service', tone: 'info',
          title: '行情数据服务未安装',
          detail: '现在只能用参考价交易；安装 FTShare 数据服务后自动恢复。',
          actions: [],
        }
      }
      const noKeyBanner = {
        id: 'no-key', tone: 'info',
        // Quotes still work on the free tier (last daily close), so the banner
        // cannot say 行情未启用; what a key adds is the realtime feed.
        title: '免费档：报价取日K收盘',
        detail: `在 ${KEY_SETTINGS} 填入 API Key 可看实时行情。`,
        actions: [],
      }
      const problem = status.problem
      if (problem !== undefined && problem !== null) {
        switch (problem.reason) {
          case 'quota':
            return {
              id: 'quota', tone: 'warn',
              // 匿名档是「最近 24 小时 500 次」的滚动额度，不是一个自然日。
              title: '免费额度已用尽',
              detail: `请在 ${KEY_SETTINGS} 获取并填入 API Key；或等约 24 小时额度恢复。`,
              actions: ['retry'],
            }
          case 'plan-denied':
            // Without a key the realtime interface is simply not enabled; a
            // "套餐未开通" banner would send a keyless user to the wrong fix.
            return status.state === 'free'
              ? noKeyBanner
              : {
                id: 'plan-denied', tone: 'warn',
                title: '当前套餐未开通实时行情',
                detail: '可用日K收盘价模拟；套餐开通后刷新即可。',
                actions: ['retry'],
              }
          case 'invalid-key':
            // The anonymous channel also answers 401 for paid interfaces, so a
            // keyless user must see the "configure a key" hint, not "key bad".
            return status.state === 'free'
              ? noKeyBanner
              : {
                id: 'invalid-key', tone: 'error',
                title: 'FTShare 数据源无法使用',
                detail: `在 ${KEY_SETTINGS} 检查 API Key。`,
                actions: ['retry'],
              }
          case 'network':
            return {
              id: 'network', tone: 'warn',
              title: '行情服务暂时不可用',
              detail: '网络或上游超时，稍后重试；账本不受影响。',
              actions: ['retry'],
            }
          default:
            return {
              id: 'upstream', tone: 'warn',
              title: '行情服务上游异常',
              // 手填参考价只覆盖市价单（期货仅市价平仓），先说清最确定的一件事。
              detail: '稍后重试；账本不受影响。',
              actions: ['retry'],
            }
        }
      }
      if (status.state === 'invalid') {
        return {
          id: 'invalid-key', tone: 'error',
          title: 'FTShare 数据源无法使用',
          detail: `${status.message === undefined || status.message === '' ? 'Key 未通过验证' : status.message}。在 ${KEY_SETTINGS} 检查 API Key。`,
          actions: [],
        }
      }
      if (status.state === 'free') return noKeyBanner
      return null
    }

    function readBannerDismissal() {
      try {
        return window.localStorage.getItem(DATA_BANNER_DISMISS_KEY) ?? ''
      } catch {
        return ''
      }
    }

    /* ------------------------------------------------------ rail layout --
       The rail's size is a user preference, never the layout authority: a drag
       stores a px hint, CSS clamps it against the workspace (the trading column
       keeps room for its ticket before the rail takes space), and the narrow
       container query drops to one column no matter what was stored. The hint
       is written on release only — a drag reports dozens of widths a second,
       and every write is synchronous local storage. */

    const LAYOUT_KEY = 'ft-paper-trading.layout.v1'
    const RAIL_LIMITS = {
      stock: { min: 320, max: 760 },
      futures: { min: 240, max: 400 },
    }
    // `pad`: how much of the workspace the trading column must keep for its
    // ticket before the rail may grow (560px form+preview + the 10px gap).
    const RAIL_MAIN_RESERVE = 570
    const KLINE_HEIGHTS = ['auto', 'tall', 'full']

    /** Defaults for both accounts; a missing or malformed entry falls back here. */
    function emptyLayout() {
      return {
        stock: { rail: null, collapsed: false, klineHeight: 'auto' },
        futures: { rail: null, collapsed: false },
      }
    }

    /** Clamp a rail width into its account's contract range. */
    function clampRail(value, mode) {
      const limits = RAIL_LIMITS[mode] ?? RAIL_LIMITS.stock
      return Math.min(limits.max, Math.max(limits.min, Math.round(value)))
    }

    /** Read the persisted layout; anything unreadable or malformed is ignored. */
    function readLayout() {
      const layout = emptyLayout()
      try {
        const raw = window.localStorage.getItem(LAYOUT_KEY)
        if (raw === null) return layout
        const saved = JSON.parse(raw)
        for (const mode of ['stock', 'futures']) {
          const slice = saved === null || typeof saved !== 'object' ? undefined : saved[mode]
          if (slice === null || slice === undefined || typeof slice !== 'object') continue
          if (typeof slice.rail === 'number' && Number.isFinite(slice.rail)) layout[mode].rail = clampRail(slice.rail, mode)
          layout[mode].collapsed = slice.collapsed === true
          if (mode === 'stock' && KLINE_HEIGHTS.includes(slice.klineHeight)) layout.stock.klineHeight = slice.klineHeight
        }
      } catch {
        // A private window or a truncated write: the panel starts at its defaults.
      }
      return layout
    }

    /** Persist one account's preference without clobbering the other's. */
    function writeLayout(mode, patch) {
      try {
        const next = readLayout()
        next[mode] = { ...next[mode], ...patch }
        window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(next))
      } catch {
        // Losing a size preference is acceptable; losing the panel is not.
      }
    }

    /** Remember the account the human looked at last; the panel re-selects it. */
    const CURRENT_ACCOUNT_KEY = 'ft-paper-trading.current-account.v1'

    function readCurrentAccount() {
      try {
        return window.localStorage.getItem(CURRENT_ACCOUNT_KEY) ?? ''
      } catch {
        return ''
      }
    }

    function writeCurrentAccount(id) {
      try {
        window.localStorage.setItem(CURRENT_ACCOUNT_KEY, id)
      } catch {
        // A private window loses the preference, not the panel.
      }
    }

    /** Both sides are canonical ids (`000001.SZ`), so compare them verbatim. */
    const shortlisted = (shortlist, symbol) => shortlist.some(item => item === symbol)

    /**
     * Why the ticket cannot be previewed yet. An incomplete draft would
     * otherwise come back priced at 0.00 — a card that looks like a real
     * order for nothing — so the panel asks for the missing field instead.
     */
    const previewBlockReason = draft => {
      if (String(draft.symbol ?? '').trim().length < 6) return '输入代码后自动计算'
      const qty = Number(draft.qty)
      if (!Number.isInteger(qty) || qty <= 0) return '填写数量后自动计算'
      if (draft.type === 'limit' && !(Number(draft.limitPrice) > 0)) return '填写限价后自动计算'
      return ''
    }

    const STATUS_TEXT = {
      queued: '待开盘',
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
      if (session.phase === 'pre_open') return '（集合竞价，09:30 开盘撮合）'
      if (session.phase === 'lunch') return '（午休，13:00 开盘撮合）'
      return '（盘后委托顺延至下一交易时段开盘）'
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
      deposit: '注资',
      withdraw: '提款',
      buy: '买入',
      sell: '卖出',
      fee: '费用',
    }
    const FUTURES_CASH_TYPE_TEXT = {
      open: '初始资金',
      deposit: '注资',
      withdraw: '提款',
      open_position: '开仓占用',
      close_position: '平仓释放',
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
      ACCOUNT_BLOCKED: '账本校验失败，账户已冻结：可让 AI 助手从备份恢复，或重置/导出账本',
      ACCOUNT_LOCKED: '账户已被人工锁定：在账户菜单里解锁后才能下单',
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
      SESSION_CLOSED: '当前时段不接受委托',
      AUCTION_ONLY: '当前时段不接受市价单',
      PRICE_LIMIT: '价格超出涨跌停范围',
      SUSPENDED: '标的停牌',
      UNSUPPORTED_INSTRUMENT: '该标的不支持交易',
      INSUFFICIENT_MARGIN: '保证金不足',
      ACCOUNT_NOT_FOUND: '账户不存在',
      ACCOUNT_LIMIT: '账户数量已达上限',
      LEDGER_RESTORE_FAILED: '账本恢复失败',
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

    /**
     * Account the stock panel is showing. The host has no "current account":
     * every account-scoped call names its target, so the panel keeps the
     * selection in one module variable and `rpc` stamps it on the envelope.
     */
    let activeAccount = null

    async function rpc(endpoint, payload, account) {
      const requestBody = { endpoint, payload: payload ?? {} }
      // Futures ledgers and the account registry have no account dimension of
      // their own; everything else is answered by the selected stock account.
      const target = account === undefined ? activeAccount : account
      if (target !== null && target !== undefined && !endpoint.startsWith('futures/') && !endpoint.startsWith('accounts/')) {
        requestBody.account = target
      }
      const response = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
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
