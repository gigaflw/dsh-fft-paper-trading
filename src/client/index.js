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
        const message = body && body.error ? body.error.message : `HTTP ${response.status}`
        throw new Error(message)
      }
      return body.value
    }

    const money = value => Number(value ?? 0).toFixed(2)
    const cents = value => (Number(value ?? 0) / 100).toFixed(2)
    const pct = value => `${(Number(value ?? 0) * 100).toFixed(2)}%`
    const signed = value => {
      const number = Number(value ?? 0)
      return `${number >= 0 ? '+' : ''}${number.toFixed(2)}`
    }
    const statusText = {
      queued: '排队',
      pending: '挂单',
      partially_filled: '部分成交',
      filled: '成交',
      canceled: '已撤',
      rejected: '拒绝',
      expired: '过期',
    }
    const PHASE_TEXT = {
      pre_open: '集合竞价',
      continuous_am: '上午连续竞价',
      lunch: '午休',
      continuous_pm: '下午连续竞价',
      auction_close: '收盘竞价',
      closed: '已收盘',
    }

    const CSS = `
      /* Accent comes from the shared FT brand layer; the local aliases keep the
         fallback in one place, so the panel still matches when fft-settings is
         absent. The brand layer publishes a value per palette. */
      .pt-root { --pt-accent:var(--ft-accent-warm,light-dark(#cf5623, #ff8352));
        --pt-accent-hover:var(--ft-accent-warm-hover,light-dark(#b8481b, #ff9a72));
        --pt-accent-ink:var(--ft-accent-warm-ink,light-dark(#ffffff, #1a120e));
        --pt-accent-soft:var(--ft-accent-warm-soft,light-dark(#fbeee8, #2b1d16));
        /* The page surface fills the whole centre column, like the host's
           other first-level pages. The readable column is capped inside it,
           so a wide window widens the surface instead of leaving the card
           as a stripe. */
        flex:1 1 auto; min-width:0; min-height:0; height:100%; box-sizing:border-box;
        overflow:auto; scrollbar-gutter:stable; width:100%; align-self:stretch;
        background:var(--dsw-alias-bg-base, #ffffff); color:var(--dsw-alias-label-primary, #171b22);
        font-size:var(--dsh-content-font-size-secondary, 13px); line-height:1.5; container-type:inline-size; }
      .pt-inner { display:flex; flex-direction:column; gap:10px; box-sizing:border-box;
        width:100%; max-width:1080px; margin:0 auto;
        padding:calc(28px + var(--dsh-frame-top-clearance, 0px)) clamp(16px, 3vw, 28px) 32px; }
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
      .pt-seg { display:flex; border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.18));
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
      .pt-card { border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.12));
        border-radius:var(--dsw-radius-sm, 8px); background:var(--dsw-alias-bg-layer-1, #fff); padding:10px; min-width:0; }
      .pt-card-title { font-size:11px; font-weight:500; letter-spacing:.04em;
        color:var(--dsw-alias-label-secondary, #49525f); margin-bottom:8px; }
      .pt-trade-grid { display:grid; grid-template-columns:minmax(0, 1fr) minmax(260px, 320px); gap:10px; align-items:start; }
      .pt-table-wrap { overflow-x:auto; min-width:0; }
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
        border-radius:var(--dsw-radius-xs, 4px); padding:7px 9px; }
      .pt-chart { width:100%; height:120px; display:block; }
      .pt-chart-wrap { border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.12));
        border-radius:var(--dsw-radius-sm, 8px); padding:8px; }
      /* Breakpoints follow the panel's own width, not the window's: the centre
         column also yields to the sidebar and the right pane, so a wide screen
         can still leave a narrow trading surface. */
      @container (max-width: 900px) { .pt-trade-grid { grid-template-columns:minmax(0, 1fr); } }
      @container (max-width: 760px) {
        .pt-stats { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
        .pt-stat:nth-child(2n) { border-right:0; }
        .pt-stat:nth-child(-n+2) { border-bottom:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.10)); }
        .pt-chart { height:96px; }
      }
      @container (max-width: 520px) {
        .pt-inner { padding-left:12px; padding-right:12px; padding-bottom:20px; }
        .pt-stat-value { font-size:15px; }
        .pt-tabs { overflow-x:auto; }
        .pt-tab { flex:0 0 auto; }
      }
      .pt-root button:focus-visible, .pt-root input:focus-visible,
      .pt-root .pt-seg button:focus-visible, .pt-root .pt-tab:focus-visible {
        outline:2px solid var(--pt-accent); outline-offset:2px; }
    `

    function Field({ label, children }) {
      return h('label', { className: 'pt-field' }, h('span', null, label), children)
    }

    /** Wide tables scroll inside their own box instead of the page. */
    function Table({ children }) {
      return h('div', { className: 'pt-table-wrap' }, h('table', { className: 'pt-table' }, children))
    }

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

    function EquityChart({ points }) {
      if (points.length === 0) return h('div', { className: 'pt-empty' }, '暂无权益快照')
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
      const values = bars.map(bar => bar.close)
      const min = Math.min(...bars.map(bar => bar.low ?? bar.close))
      const max = Math.max(...bars.map(bar => bar.high ?? bar.close))
      const span = max - min || Math.max(1, max * 0.02)
      const x = index => bars.length === 1 ? width / 2 : (index / (bars.length - 1)) * (width - 20) + 10
      const y = value => height - ((value - min) / span) * (height - 24) - 12
      const line = bars.map((bar, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(bar.close).toFixed(1)}`).join(' ')
      return h('svg', { className: 'pt-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': interval === 'minute' ? '分时图' : '日K线' },
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

    function Dashboard({ renderSlot } = {}) {
      const [account, setAccount] = useState(null)
      const [orders, setOrders] = useState([])
      const [trades, setTrades] = useState([])
      const [review, setReview] = useState(null)
      const [period, setPeriod] = useState('30d')
      const [tab, setTab] = useState('trade')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState(false)
      const [quote, setQuote] = useState(null)
      const [preview, setPreview] = useState(null)
      const [session, setSession] = useState(null)
      const [searchQuery, setSearchQuery] = useState('')
      const [searchHits, setSearchHits] = useState([])
      const [marketList, setMarketList] = useState(null)
      const [marketBoard, setMarketBoard] = useState('main')
      const [bars, setBars] = useState([])
      const [barInterval, setBarInterval] = useState('day')
      const [daily, setDaily] = useState([])
      const [cashFlow, setCashFlow] = useState([])
      const [trips, setTrips] = useState([])
      const [watchlist, setWatchlist] = useState([])
      const [watchOnly, setWatchOnly] = useState(false)
      const [form, setForm] = useState({
        symbol: '600519',
        side: 'buy',
        type: 'market',
        qty: '100',
        limitPrice: '',
        price: '',
        note: '',
      })

      const alive = useRef(true)
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
      }, [])

      const loadAll = useCallback(async (quiet = false) => {
        try {
          const [nextAccount, nextOrders, nextTrades, nextReview, nextSession] = await Promise.all([
            rpc('account/get'),
            rpc('list/orders'),
            rpc('list/trades'),
            rpc('review/get', { period }),
            rpc('market/status'),
          ])
          if (!alive.current) return
          setAccount(nextAccount)
          setOrders(nextOrders)
          setTrades(nextTrades)
          setReview(nextReview)
          setSession(nextSession)
          if (!quiet) setError('')
        } catch (cause) {
          if (alive.current) setError(cause.message)
        }
      }, [period])

      useEffect(() => { loadAll() }, [loadAll])

      const tick = useCallback(async () => {
        try {
          const result = await rpc('tick')
          if (!alive.current) return
          if (result.filled.length > 0) setNotice(`成交 ${result.filled.length} 笔`)
          if (result.notices.length > 0) setNotice(result.notices.join('；'))
          await loadAll(true)
        } catch {
          // Polling failures stay silent; the manual refresh shows the error.
        }
      }, [loadAll])

      useEffect(() => {
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') tick()
        }, 5000)
        return () => clearInterval(timer)
      }, [tick])

      const loadBars = useCallback(async (symbol = form.symbol) => {
        if (!symbol.trim()) return
        try {
          const result = await rpc('market/bars', { symbol: symbol.trim(), interval: barInterval, limit: 80 })
          if (alive.current) setBars(result.bars ?? [])
        } catch (cause) {
          if (alive.current) setError(cause.message)
        }
      }, [form.symbol, barInterval])

      const runSearch = useCallback(async () => {
        if (!searchQuery.trim()) return
        try {
          setSearchHits(await rpc('market/search', { query: searchQuery.trim(), limit: 12 }))
        } catch (cause) {
          setError(cause.message)
        }
      }, [searchQuery])

      const loadMarket = useCallback(async (page = 1) => {
        try {
          setMarketList(await rpc('market/list', { board: marketBoard, page, pageSize: 50 }))
        } catch (cause) {
          setError(cause.message)
        }
      }, [marketBoard])

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
          if (alive.current) setError(cause.message)
        }
      }, [])

      useEffect(() => {
        if (tab === 'market') void loadBars()
      }, [tab, barInterval, loadBars])

      useEffect(() => {
        if (tab === 'review') void loadReviewDetail()
      }, [tab, loadReviewDetail])

      useEffect(() => {
        if (tab === 'market') {
          void loadMarket(1)
          rpc('watchlist/get').then(result => { if (alive.current) setWatchlist(result.symbols ?? []) }).catch(() => {})
        }
      }, [tab, marketBoard, loadMarket])

      const toggleWatch = useCallback(async (symbol) => {
        const next = watchlist.includes(symbol) ? watchlist.filter(item => item !== symbol) : [...watchlist, symbol]
        try {
          const result = await rpc('watchlist/set', { symbols: next })
          if (alive.current) setWatchlist(result.symbols ?? next)
        } catch (cause) {
          if (alive.current) setError(cause.message)
        }
      }, [watchlist])

      const refreshQuote = useCallback(async () => {
        if (!form.symbol.trim()) return
        setBusy(true)
        try {
          const result = await rpc('market/quote', { symbols: [form.symbol.trim()] })
          setQuote(result.quotes[0] ?? null)
          setNotice(result.notice ?? (result.quotes.length === 0 ? '没有查到行情' : ''))
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy(false)
        }
      }, [form.symbol])

      const draft = useCallback(() => ({
        symbol: form.symbol.trim(),
        side: form.side,
        type: form.type,
        qty: Number(form.qty),
        limitPrice: form.type === 'limit' ? Number(form.limitPrice) : undefined,
        price: form.type === 'market' && form.price !== '' ? Number(form.price) : undefined,
        note: form.note.trim() === '' ? undefined : form.note.trim(),
      }), [form])

      const doPreview = useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          setPreview(await rpc('order/preview', draft()))
        } catch (cause) {
          setPreview(null)
          setError(cause.message)
        } finally {
          setBusy(false)
        }
      }, [draft])

      const doSubmit = useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`
          const order = await rpc('order/place', { draft: draft(), requestId })
          setNotice(`${statusText[order.status] ?? order.status}：${order.symbol} ${order.qty} 股${order.reason ? `（${order.reason}）` : ''}`)
          setPreview(null)
          await loadAll(true)
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy(false)
        }
      }, [draft, loadAll])

      const cancel = useCallback(async orderId => {
        setBusy(true)
        try {
          await rpc('order/cancel', { orderId })
          await loadAll(true)
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy(false)
        }
      }, [loadAll])

      const reset = useCallback(async () => {
        if (!window.confirm('重置模拟交易账户？持仓与挂单会清空。')) return
        setBusy(true)
        try {
          setAccount(await rpc('account/reset', { confirm: true }))
          setQuote(null)
          setPreview(null)
          await loadAll(true)
          setNotice('账户已重置')
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy(false)
        }
      }, [loadAll])

      const pending = useMemo(() => orders.filter(order => order.status === 'pending' || order.status === 'queued' || order.status === 'partially_filled'), [orders])
      const history = useMemo(() => orders.filter(order => order.status !== 'pending' && order.status !== 'queued' && order.status !== 'partially_filled'), [orders])
      const positions = account?.positions ?? []

      if (account === null) {
        return h('div', { className: 'pt-root' }, h('style', null, CSS),
          h('div', { className: 'pt-inner' }, error ? h('div', { className: 'pt-error' }, error) : h('div', { className: 'pt-empty' }, '加载模拟交易…')))
      }

      return h('div', { className: 'pt-root' },
        h('style', null, CSS),
        h('div', { className: 'pt-inner' },
          h('div', { className: 'pt-head' },
            h('div', null,
              h('h3', { className: 'pt-title' }, '模拟交易'),
              h('div', { className: 'pt-sub' },
                `${account.tradeDate} · ${session ? PHASE_TEXT[session.phase] : '时段未知'} · 初始 ${money(account.initialCash)} · ${account.blocked ? '已锁定' : '运行中'}`,
                session && !session.canMatch ? h('span', { className: 'pt-note' }, '（仅可预埋限价单）') : null,
              ),
            ),
            h('div', { className: 'pt-row' },
              h('button', { className: 'pt-btn', onClick: () => loadAll(), disabled: busy }, '刷新'),
              h('button', { className: 'pt-btn pt-btn-danger', onClick: reset, disabled: busy }, '重置'),
            ),
          ),
          account.blocked ? h('div', { className: 'pt-blocked' }, '账本校验失败，账户已锁定。请导出事件文件检查后重置。') : null,
          h('div', { className: 'pt-stats' },
            h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '总资产'), h('div', { className: 'pt-stat-value' }, money(account.equity))),
            h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '可用现金'), h('div', { className: 'pt-stat-value' }, money(account.cash))),
            h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '浮动盈亏'), h('div', { className: `pt-stat-value ${account.pnl >= 0 ? 'pt-up' : 'pt-down'}` }, signed(account.pnl))),
            h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '今日盈亏'), h('div', { className: `pt-stat-value ${account.todayPnl >= 0 ? 'pt-up' : 'pt-down'}` }, signed(account.todayPnl))),
          ),
          error ? h('div', { className: 'pt-error' }, error) : null,
          notice ? h('div', { className: 'pt-note' }, notice) : null,
          h('div', { className: 'pt-tabs' },
            [['trade', '交易'], ['market', '行情'], ['positions', `持仓 ${positions.length}`], ['orders', `订单 ${pending.length}`], ['review', '复盘']].map(([key, label]) =>
              h('button', { key, className: 'pt-tab', 'data-active': tab === key, onClick: () => setTab(key) }, label),
            ),
          ),

          tab === 'trade' ? h('div', { className: 'pt-trade-grid' },
            h('div', { className: 'pt-card' },
              h('div', { className: 'pt-card-title' }, '下单'),
              h('div', { className: 'pt-row' },
                h(Field, { label: '代码' }, h('input', {
                  className: 'pt-input', style: { width: 104 }, value: form.symbol,
                  onChange: event => setForm(prev => ({ ...prev, symbol: event.target.value.toUpperCase() })),
                })),
                h('div', { className: 'pt-seg' },
                  [['buy', '买入'], ['sell', '卖出']].map(([key, label]) =>
                    h('button', { key, 'data-active': form.side === key, onClick: () => setForm(prev => ({ ...prev, side: key })) }, label),
                  ),
                ),
                h('div', { className: 'pt-seg' },
                  [['market', '市价'], ['limit', '限价']].map(([key, label]) =>
                    h('button', { key, 'data-active': form.type === key, onClick: () => setForm(prev => ({ ...prev, type: key })) }, label),
                  ),
                ),
                h(Field, { label: '数量' }, h(DebouncedNumber, {
                  value: form.qty, min: 0, step: 100,
                  onChange: value => setForm(prev => ({ ...prev, qty: value })),
                })),
                form.type === 'limit' ? h(Field, { label: '限价' }, h(DebouncedNumber, {
                  value: form.limitPrice, min: 0, step: 0.01,
                  onChange: value => setForm(prev => ({ ...prev, limitPrice: value })),
                })) : null,
                h('button', { className: 'pt-btn', onClick: refreshQuote, disabled: busy }, '查行情'),
              ),
              quote ? h('div', { className: 'pt-quote', style: { marginTop: 8 } },
                h('span', null, `${quote.symbol} ${quote.name ?? ''}`),
                h('span', null, `现价 ${quote.last.toFixed(2)}`),
                h('span', { className: 'pt-note' }, quote.source === 'manual' ? '手动价' : quote.marketTs ? new Date(quote.marketTs).toLocaleTimeString() : '无行情时间'),
              ) : h('div', { className: 'pt-note', style: { marginTop: 8 } }, '未取到行情时可填参考价，市价单按参考价成交。'),
              form.type === 'market' ? h('div', { className: 'pt-row', style: { marginTop: 8 } },
                h(Field, { label: '参考价（可选）' }, h(DebouncedNumber, {
                  value: form.price, min: 0, step: 0.01,
                  onChange: value => setForm(prev => ({ ...prev, price: value })),
                })),
              ) : null,
              h('div', { className: 'pt-row', style: { marginTop: 8 } },
                h('button', { className: 'pt-btn', onClick: doPreview, disabled: busy }, '预览'),
                h('button', { className: 'pt-btn pt-btn-primary', onClick: doSubmit, disabled: busy || (form.type === 'market' && session !== null && !session.canMatch) }, form.side === 'buy' ? '买入' : '卖出'),
              ),
              h('div', { className: 'pt-row', style: { marginTop: 8 } },
                h(Field, { label: '备注（复盘用）' }, h('input', {
                  className: 'pt-input', style: { flex: 1, minWidth: 180 }, value: form.note, maxLength: 120,
                  onChange: event => setForm(prev => ({ ...prev, note: event.target.value })),
                })),
              ),
            ),
            h('div', { className: 'pt-card' },
              h('div', { className: 'pt-card-title' }, '预览'),
              preview ? h('div', { className: 'pt-preview' },
                h('div', null, h('span', null, '价格'), h('span', null, preview.price.toFixed(2))),
                h('div', null, h('span', null, '金额'), h('span', null, cents(preview.amountCents))),
                h('div', null, h('span', null, '佣金'), h('span', null, cents(preview.commissionCents))),
                h('div', null, h('span', null, '印花税'), h('span', null, cents(preview.stampCents))),
                h('div', null, h('span', null, '过户费'), h('span', null, cents(preview.transferCents))),
                h('div', null, h('span', null, '成交后现金'), h('span', null, cents(preview.cashAfterCents))),
                preview.warnings.length > 0 ? h('div', { className: 'pt-warn' }, preview.warnings.join('；')) : null,
              ) : h('div', { className: 'pt-empty' }, '点「预览」计算费用与现金影响'),
            ),
          ) : null,


          tab === 'market' ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
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
                    onClick: () => {
                      setForm(prev => ({ ...prev, symbol: hit.symbol }))
                      setQuote(null)
                      setTab('trade')
                      rpc('market/quote', { symbols: [hit.symbol] }).then(result => setQuote(result.quotes[0] ?? null)).catch(cause => setError(cause.message))
                      void loadBars(hit.symbol)
                    },
                  }, `${hit.symbol} ${hit.name}`),
                  h('button', { className: 'pt-btn', onClick: () => toggleWatch(hit.symbol) }, watchlist.includes(hit.symbol) ? '已自选' : '加自选'),
                )),
              ) : null,
            ),
            h('div', { className: 'pt-card' },
              h('div', { className: 'pt-row' },
                h('div', { className: 'pt-card-title', style: { margin: 0 } }, '全市场'),
                [['main', '主板'], ['star', '科创板'], ['chi_next', '创业板'], ['bjse', '北交所'], ['xshg', '沪市'], ['xshe', '深市']].map(([key, label]) =>
                  h('button', { key, className: 'pt-btn', 'data-active': marketBoard === key, onClick: () => setMarketBoard(key) }, label),
                ),
                h('button', { className: 'pt-btn', 'data-active': watchOnly, onClick: () => setWatchOnly(value => !value) }, '只看自选'),
                h('button', { className: 'pt-btn', onClick: () => loadMarket((marketList?.page ?? 1) + 1) }, '下一页'),
              ),
              marketList === null ? h('div', { className: 'pt-empty' }, '加载行情…')
                : marketList.quotes.length === 0 ? h('div', { className: 'pt-empty' }, marketList.notice ?? '没有行情')
                  : h(Table, null,
                    h('thead', null, h('tr', null, ['代码', '名称', '现价', '涨跌幅', '状态', '自选'].map(label => h('th', { key: label }, label)))),
                    h('tbody', null, marketList.quotes.filter(item => !watchOnly || watchlist.includes(item.symbol)).slice(0, 50).map(item => {
                      const change = item.prevClose && item.prevClose > 0 ? (item.last - item.prevClose) / item.prevClose : null
                      return h('tr', {
                        key: `${item.symbol}-${item.last}`, style: { cursor: 'pointer' },
                        onClick: () => { setForm(prev => ({ ...prev, symbol: item.symbol })); setQuote(item); setTab('trade'); void loadBars(item.symbol) },
                      },
                        h('td', null, item.symbol),
                        h('td', null, item.name ?? '—'),
                        h('td', null, item.last.toFixed(2)),
                        h('td', { className: change !== null && change < 0 ? 'pt-down' : 'pt-up' }, change === null ? '—' : pct(change)),
                        h('td', null, item.status ?? '—'),
                        h('td', null, h('button', { className: 'pt-btn', onClick: event => { event.stopPropagation(); void toggleWatch(item.symbol) } }, watchlist.includes(item.symbol) ? '★' : '☆')),
                      )
                    })),
                  ),
            ),
            h('div', { className: 'pt-card' },
              h('div', { className: 'pt-row' },
                h('div', { className: 'pt-card-title', style: { margin: 0 } }, `${form.symbol} K 线`),
                h('div', { className: 'pt-seg' },
                  [['day', '日K'], ['minute', '分时']].map(([key, label]) =>
                    h('button', { key, 'data-active': barInterval === key, onClick: () => setBarInterval(key) }, label),
                  ),
                ),
                h('button', { className: 'pt-btn', onClick: () => loadBars() }, '刷新'),
              ),
              (() => {
                const slot = typeof renderSlot === 'function'
                  ? renderSlot('paperTrading.kline', {
                    symbol: form.symbol,
                    onIdentity: (symbol, name) => {
                      if (!symbol) return
                      setForm(prev => ({ ...prev, symbol }))
                      setQuote(prev => prev && prev.symbol === symbol ? prev : null)
                      void loadBars(symbol)
                    },
                  })
                  : null
                if (slot) return h('div', { style: { height: 420, minHeight: 280, marginTop: 8 } }, slot)
                return h('div', null,
                  h(PriceChart, { bars, interval: barInterval }),
                  h('div', { className: 'pt-note' }, '安装 dsh_kline 后此处由它提供完整 K 线视图；当前为内置简图。'),
                )
              })(),
            ),
          ) : null,

          tab === 'positions' ? (positions.length === 0 ? h('div', { className: 'pt-empty' }, '无持仓') : h(Table, null,
            h('thead', null, h('tr', null,
              ['代码', '名称', '数量', '可卖', '成本', '现价', '浮盈亏'].map(label => h('th', { key: label }, label)),
              h('th', null, ''),
            )),
            h('tbody', null, positions.map(position => h('tr', { key: position.symbol },
              h('td', null, position.symbol),
              h('td', null, position.name ?? '—'),
              h('td', null, position.qty),
              h('td', null, position.available),
              h('td', null, position.avgCost.toFixed(2)),
              h('td', null, position.lastPrice === undefined ? '—' : position.lastPrice.toFixed(2)),
              h('td', { className: (position.unrealizedPnlCents ?? 0) >= 0 ? 'pt-up' : 'pt-down' }, cents(position.unrealizedPnlCents)),
              h('td', null, h('button', {
                className: 'pt-btn',
                onClick: () => {
                  setForm(prev => ({ ...prev, symbol: position.symbol, side: 'sell', type: 'market', qty: String(Math.min(position.available, position.qty)) }))
                  setTab('trade')
                },
                disabled: position.available <= 0,
              }, '卖出')),
            ))),
          )) : null,

          tab === 'orders' ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
            h('div', null,
              h('div', { className: 'pt-sub' }, '挂单'),
              pending.length === 0 ? h('div', { className: 'pt-empty' }, '无挂单') : h(Table, null,
                h('thead', null, h('tr', null, ['代码', '方向', '类型', '数量', '限价', '状态', ''].map(label => h('th', { key: label }, label)))),
                h('tbody', null, pending.map(order => h('tr', { key: order.id },
                  h('td', null, order.symbol),
                  h('td', null, order.side === 'buy' ? '买' : '卖'),
                  h('td', null, order.type === 'limit' ? '限价' : '市价'),
                  h('td', null, order.qty),
                  h('td', null, order.limitPrice === undefined ? '—' : order.limitPrice.toFixed(2)),
                  h('td', null, statusText[order.status]),
                  h('td', null, h('button', { className: 'pt-btn', onClick: () => cancel(order.id), disabled: busy }, '撤单')),
                ))),
              ),
            ),
            h('div', null,
              h('div', { className: 'pt-sub' }, '历史'),
              history.length === 0 ? h('div', { className: 'pt-empty' }, '无历史订单') : h(Table, null,
                h('thead', null, h('tr', null, ['时间', '代码', '方向', '数量', '状态', '成交价', '原因'].map(label => h('th', { key: label }, label)))),
                h('tbody', null, history.slice(0, 30).map(order => h('tr', { key: order.id },
                  h('td', null, new Date(order.createdAt).toLocaleString()),
                  h('td', null, order.symbol),
                  h('td', null, order.side === 'buy' ? '买' : '卖'),
                  h('td', null, order.qty),
                  h('td', null, statusText[order.status] ?? order.status),
                  h('td', null, order.fillPrice === undefined ? '—' : order.fillPrice.toFixed(2)),
                  h('td', null, order.reason ?? ''),
                ))),
              ),
            ),
          ) : null,

          tab === 'review' ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            h('div', { className: 'pt-row' }, PERIODS.map(([key, label]) =>
              h('button', {
                key, className: 'pt-btn', 'data-active': period === key,
                onClick: () => { setPeriod(key); rpc('review/get', { period: key }).then(setReview).catch(cause => setError(cause.message)) },
              }, label),
            )),
            review ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              h('div', { className: 'pt-stats' },
                h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '成交笔数'), h('div', { className: 'pt-stat-value' }, String(review.tradeCount))),
                h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '已实现盈亏'), h('div', { className: `pt-stat-value ${review.realizedPnl >= 0 ? 'pt-up' : 'pt-down'}` }, signed(review.realizedPnl))),
                h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '费用合计'), h('div', { className: 'pt-stat-value' }, money(review.totalFees))),
                h('div', { className: 'pt-stat' }, h('div', { className: 'pt-stat-label' }, '最大回撤'), h('div', { className: 'pt-stat-value' }, pct(review.maxDrawdownPct))),
              ),
              h('div', { className: 'pt-chart-wrap' }, h(EquityChart, { points: review.equityCurve })),
              h('div', null,
                h('div', { className: 'pt-sub' }, '成交记录'),
                trades.length === 0 ? h('div', { className: 'pt-empty' }, '无成交') : h(Table, null,
                  h('thead', null, h('tr', null, ['时间', '代码', '方向', '数量', '价格', '金额', '费用'].map(label => h('th', { key: label }, label)))),
                  h('tbody', null, trades.slice(0, 30).map(trade => h('tr', { key: trade.id },
                    h('td', null, new Date(trade.ts).toLocaleString()),
                    h('td', null, trade.symbol),
                    h('td', null, trade.side === 'buy' ? '买' : '卖'),
                    h('td', null, trade.qty),
                    h('td', null, trade.price.toFixed(2)),
                    h('td', null, cents(trade.amountCents)),
                    h('td', null, cents(trade.feesCents)),
                  ))),
                ),
              ),
              h('div', null,
                h('div', { className: 'pt-sub' }, '日终报告'),
                daily.length === 0 ? h('div', { className: 'pt-empty' }, '暂无日终快照') : h(Table, null,
                  h('thead', null, h('tr', null, ['日期', '权益', '当日盈亏', '费用', '收盘价来源'].map(label => h('th', { key: label }, label)))),
                  h('tbody', null, daily.slice(-14).reverse().map(row => h('tr', { key: row.date },
                    h('td', null, row.date),
                    h('td', null, money(row.equity)),
                    h('td', { className: row.dayPnl >= 0 ? 'pt-up' : 'pt-down' }, signed(row.dayPnl)),
                    h('td', null, money(row.fees)),
                    h('td', null, row.closeSource === 'daily' ? '日K收盘' : row.closeSource === 'last' ? '最后报价' : '缺失'),
                  ))),
                ),
              ),
              h('div', null,
                h('div', { className: 'pt-sub' }, '资金流水'),
                cashFlow.length === 0 ? h('div', { className: 'pt-empty' }, '暂无流水') : h(Table, null,
                  h('thead', null, h('tr', null, ['时间', '类型', '金额', '余额'].map(label => h('th', { key: label }, label)))),
                  h('tbody', null, cashFlow.slice(-30).reverse().map((row, index) => h('tr', { key: `${row.ts}-${index}` },
                    h('td', null, new Date(row.ts).toLocaleString()),
                    h('td', null, row.type),
                    h('td', { className: row.amount >= 0 ? 'pt-up' : 'pt-down' }, signed(row.amount)),
                    h('td', null, money(row.balance)),
                  ))),
                ),
              ),
              h('div', null,
                h('div', { className: 'pt-sub' }, '回合统计'),
                trips.length === 0 ? h('div', { className: 'pt-empty' }, '暂无已平仓回合') : h(Table, null,
                  h('thead', null, h('tr', null, ['代码', '数量', '成本', '收入', '盈亏', '持有天数'].map(label => h('th', { key: label }, label)))),
                  h('tbody', null, trips.slice(0, 30).map(trip => h('tr', { key: trip.symbol },
                    h('td', null, trip.symbol),
                    h('td', null, trip.qty),
                    h('td', null, money(trip.cost)),
                    h('td', null, money(trip.proceeds)),
                    h('td', { className: trip.pnl >= 0 ? 'pt-up' : 'pt-down' }, signed(trip.pnl)),
                    h('td', null, trip.holdingDays),
                  ))),
                ),
              ),
            ) : h('div', { className: 'pt-empty' }, '加载复盘…'),
          ) : null,
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
