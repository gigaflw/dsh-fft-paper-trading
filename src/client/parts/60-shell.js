/* 60 · shell — top-level Dashboard and the stock dashboard (state + effects). */

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
      const periodRef = useRef(period)
      useEffect(() => { periodRef.current = period }, [period])
      const [tab, setTab] = useState('trade')
      const [compareData, setCompareData] = useState(null)
      const [compareError, setCompareError] = useState('')
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState(false)
      const [layout, applyLayout] = useRailLayout('stock')
      const [resetNonce, setResetNonce] = useState(0)
      // Inline cash panel (注资/提款), hidden until the header button is pressed.
      const [cashOpen, setCashOpen] = useState(false)
      const [cashSide, setCashSide] = useState('deposit')
      const [cashAmount, setCashAmount] = useState('')
      // Inline reset strip: picking the starting cash is part of the reset, so
      // it replaces the browser confirm dialog instead of living in settings.
      const [resetOpen, setResetOpen] = useState(false)
      const [resetCash, setResetCash] = useState('')
      const submitting = useRef(false)
      const placeKey = useRef({ key: '', id: '' })
      const [dataSource, setDataSource] = useState(null)
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
      const [shortlist, setShortlist] = useState([])
      // Read/write the shortlist through a ref so two clicks in one task see
      // each other's optimistic change instead of both computing from stale
      // state (which silently dropped the first symbol).
      const shortlistRef = useRef([])
      const shortlistSeq = useRef(0)
      const searchSeq = useRef(0)
      const marketSeq = useRef(0)
      useEffect(() => { shortlistRef.current = shortlist }, [shortlist])
      const [shortlistOnly, setShortlistOnly] = useState(false)
      const [form, setForm] = useState({
        symbol: '600519.SH',
        side: 'buy',
        type: 'market',
        qty: '',
        limitPrice: '',
        price: '',
        note: '',
      })

      const accountScope = useRef(null)
      /** This mount's account-scoped request; an explicit account wins (notes). */
      const request = useCallback((endpoint, payload, account) =>
        rpc(endpoint, payload, account === undefined ? accountScope.current : account), [])

      const ticket = useTicketPreview(request, form)
      const {
        preview, previewState, previewError, symbolQuote, quote, quoteError, quoteNotice,
        previewDraft, draft, maybeRefreshQuote, forceQuoteRefresh, invalidate: invalidateTicket, bump: bumpTicket,
      } = ticket

      const alive = useRef(true)
      const loadAllSeq = useRef(0)
      const detailSeq = useRef(0)
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
      }, [])

      const formSymbol = useRef(form.symbol)
      useEffect(() => { formSymbol.current = form.symbol }, [form.symbol])

      const loadAll = useCallback(async (quiet = false, reviewPeriod = periodRef.current) => {
        const seq = ++loadAllSeq.current
        const requestedPeriod = reviewPeriod
        try {
          const [nextAccount, nextOrders, nextTrades, nextReview, nextSession, nextDataSource] = await Promise.all([
            request('account/get'),
            request('list/orders'),
            request('list/trades'),
            request('review/get', { period: reviewPeriod }),
            request('market/status'),
            request('market/data-source'),
          ])
          if (!alive.current) return null
          // A poll started before a period switch carries the old review;
          // newer requests own the page state, but callers still get their own
          // snapshot (order receipts need the fresh cash).
          if (seq === loadAllSeq.current && requestedPeriod === periodRef.current) {
            setAccount(nextAccount)
            setOrders(nextOrders)
            setTrades(nextTrades)
            setReview(nextReview)
            setSession(nextSession)
            setDataSource(nextDataSource)
            if (!quiet) setError(null)
          }
          return { account: nextAccount, orders: nextOrders, trades: nextTrades }
        } catch (cause) {
          if (alive.current && seq === loadAllSeq.current) setError(errorOf(cause))
          return null
        }
      }, [])

      const loadReviewDetail = useCallback(async () => {
        const seq = ++detailSeq.current
        try {
          const [nextDaily, nextCash, nextTrips] = await Promise.all([
            request('review/daily'),
            request('cash/flow'),
            request('review/roundtrips'),
          ])
          if (!alive.current || seq !== detailSeq.current) return
          setDaily(nextDaily)
          setCashFlow(nextCash)
          setTrips(nextTrips)
        } catch (cause) {
          if (alive.current && seq === detailSeq.current) setError(errorOf(cause))
        }
      }, [])

      const loadCompare = useCallback(async () => {
        try {
          const view = await request('compare/get')
          if (!alive.current) return
          setCompareData(view)
          setCompareError('')
        } catch (cause) {
          if (alive.current) setCompareError(errorOf(cause).text)
        }
      }, [])

      // A period switch only re-queries the review bundle. It must not re-run
      // the account-switch effect (which clears the open ticket's preview and
      // receipt); `tab` is read but not a dependency for the same reason.
      const periodMounted = useRef(false)
      useEffect(() => {
        if (!periodMounted.current) {
          periodMounted.current = true
          return
        }
        void loadAll(false)
        if (tab === 'review') void loadReviewDetail()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [period, loadAll, loadReviewDetail])

      /** Per-account view state cleared on every account switch. */
      const clearAccountView = useCallback(() => {
        setNotice('')
        setReceipt(null)
        ticket.clear()
      }, [ticket.clear])

      const registry = useAccountRegistry({
        scope: accountScope, request,
        tab,
        loadAll,
        loadReviewDetail,
        loadCompare,
        clearView: clearAccountView,
        setBusy,
        setError,
        setNotice,
        onNotes: () => setTab('notes'),
      })
      const {
        tickMs, stockAccounts, currentAccountId, setCurrentAccountId, currentAccount,
        accountEditor, setAccountEditor, submitAccountEditor, runAccountAction,
      } = registry

      const notes = useAccountNotes(request, currentAccountId, tab)

      const tick = useCallback(async () => {
        try {
          const result = await request('tick')
          if (!alive.current) return
          if (result.filled.length > 0) setNotice(`成交 ${result.filled.length} 笔`)
          if (result.notices.length > 0) setNotice(result.notices.join('；'))
          await loadAll(true, periodRef.current)
          if (alive.current && tab === 'review') await loadReviewDetail()
          if (alive.current && tab === 'compare') await loadCompare()
          // Re-price the open ticket: the quote strip and preview otherwise
          // froze at the moment the symbol was entered.
          if (alive.current) maybeRefreshQuote()
        } catch {
          // Polling failures stay silent; the manual refresh shows the error.
        }
      }, [loadAll, loadReviewDetail, loadCompare, tab, maybeRefreshQuote])

      // The host scheduler is the primary matcher; this stays as a live extra
      // trigger while the panel is visible.
      useVisiblePolling(tick, tickMs)

      const loadBars = useCallback(async (symbol = form.symbol) => {
        const seq = ++barsSeq.current
        if (symbol.trim().length < 6) {
          // Do not leave the previous symbol's candles under a new title.
          if (alive.current) { setBars([]); setBarError('') }
          return
        }
        try {
          const result = await request('market/bars', { symbol: symbol.trim(), interval: barInterval, limit: 80 })
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
          const hits = await request('market/search', { query: searchQuery.trim(), limit: 12 })
          if (alive.current && seq === searchSeq.current) setSearchHits(hits)
        } catch (cause) {
          if (alive.current && seq === searchSeq.current) setError(errorOf(cause))
        }
      }, [searchQuery])

      const loadMarket = useCallback(async (page = 1) => {
        const seq = ++marketSeq.current
        try {
          const next = await request('market/list', { board: marketBoard, page, pageSize: 50 })
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
        const next = foldHostSymbol(symbol)
        if (!next || next === String(formSymbol.current).trim().toUpperCase()) return
        formSymbol.current = next
        setForm(prev => ({ ...prev, symbol: next }))
        setNotice(name ? `已从 K 线选择 ${name}` : '')
      }, [])

      useEffect(() => { void loadBars() }, [loadBars])

      useEffect(() => {
        if (tab === 'review') void loadReviewDetail()
        if (tab === 'compare') void loadCompare()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [tab, loadReviewDetail, loadCompare])

      useEffect(() => {
        if (tab === 'market') {
          void loadMarket(1)
          request('shortlist/get').then(result => { if (alive.current) setShortlist(result.symbols ?? []) }).catch(() => {})
        }
      }, [tab, marketBoard, loadMarket])

      const isShortlisted = useCallback(symbol => shortlisted(shortlist, symbol), [shortlist])

      const toggleShortlist = useCallback(async (symbol) => {
        const code = symbol
        // The server only ever sends canonical ids, and the same id is what the
        // shortlist keeps, so one favourite cannot split across markets.
        const current = shortlistRef.current
        const next = current.some(item => item === code)
          ? current.filter(item => item !== code)
          : [...current, code]
        shortlistRef.current = next
        setShortlist(next)
        const seq = ++shortlistSeq.current
        try {
          const result = await request('shortlist/set', { symbols: next })
          if (!alive.current || seq !== shortlistSeq.current) return
          shortlistRef.current = result.symbols ?? next
          setShortlist(result.symbols ?? next)
        } catch (cause) {
          if (!alive.current) return
          setError(errorOf(cause))
          // The server is the source of truth after a failed write.
          try {
            const fresh = await request('shortlist/get')
            if (alive.current && seq === shortlistSeq.current) {
              shortlistRef.current = fresh.symbols ?? []
              setShortlist(fresh.symbols ?? [])
            }
          } catch { /* keep the optimistic state */ }
        }
      }, [])

      const adoptQuote = useCallback(symbol => {
        const next = symbol
        formSymbol.current = next
        setForm(prev => ({ ...prev, symbol: next }))
        setTab('trade')
      }, [])

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
          const order = await request('order/place', { draft: current, requestId: placeKey.current.id })
          const snapshot = await loadAll(true)
          const fill = snapshot === null ? undefined : snapshot.trades.find(item => item.orderId === order.id)
          setReceipt({ order, fill, cash: snapshot === null ? undefined : snapshot.account.cash })
          placeKey.current = { key: '', id: '' }
          // Keep the card's numbers; recompute them against the new cash.
          bumpTicket()
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
          await request('order/cancel', { orderId })
          await loadAll(true)
        } catch (cause) {
          // A lost response can make the retry see an already-finished order;
          // resync instead of claiming the cancel failed.
          if (cause && (cause.code === 'ORDER_NOT_PENDING' || cause.code === 'ORDER_NOT_FOUND')) {
            setNotice('订单已结束，列表已刷新')
            await loadAll(true)
          } else {
            setError(errorOf(cause))
          }
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
          const result = await request('account/export')
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
        const cents = cashAmountCents(resetCash)
        if (cents === null) return
        setBusy(true)
        try {
          setAccount(await request('account/reset', { confirm: true, initialCash: cents / 100 }))
          invalidateTicket()
          setReceipt(null)
          await loadAll(true)
          await loadReviewDetail()
          bumpTicket()
          setResetNonce(value => value + 1)
          setResetOpen(false)
          setResetCash('')
          setNotice(`账户已重置，初始资金 ${money(cents / 100)}`)
        } catch (cause) {
          setError(errorOf(cause))
        } finally {
          setBusy(false)
        }
      }, [resetCash, loadAll, loadReviewDetail])

      /** 注资/提款：写一条账本事件，现金与总资产随之更新，盈亏剔除净入金。 */
      const moveCash = useCallback(async () => {
        const cents = cashAmountCents(cashAmount)
        if (cents === null) return
        const amount = cents / 100
        const depositing = cashSide === 'deposit'
        setBusy(true)
        try {
          setAccount(await request(depositing ? 'account/deposit' : 'account/withdraw', { amount }))
          await loadAll(true)
          await loadReviewDetail()
          bumpTicket()
          setCashAmount('')
          setCashOpen(false)
          setError(null)
          setNotice(depositing ? `已注资 ${money(amount)}` : `已提款 ${money(amount)}`)
        } catch (cause) {
          setError(errorOf(cause))
        } finally {
          setBusy(false)
        }
      }, [cashAmount, cashSide, loadAll, loadReviewDetail])

      /** Header refresh: account/orders/trades/review plus one fresh preview. */
      const refreshAll = useCallback(async () => {
        setBusy(true)
        try {
          await loadAll()
          if (tab === 'review') await loadReviewDetail()
          if (tab === 'compare') await loadCompare()
          // 刷新 must also retry the current tab's own fetch, not just the
          // account bundle: a failed market list otherwise stays broken.
          if (tab === 'market') await loadMarket(marketList?.page ?? 1)
          // Force the incomplete-draft quote branch to fetch again even when
          // the symbol did not change (a transient quote failure is retryable).
          forceQuoteRefresh()
        } finally {
          setBusy(false)
        }
      }, [loadAll, loadReviewDetail, tab, loadMarket, marketList?.page, forceQuoteRefresh])

      /** Only real blockers disable submit; a failed preview never does. */
      /** Read the flag outside the deps array: `account` is null on the first render. */
      const blocked = account?.blocked === true
      const submitReason = useMemo(() => {
        if (account === null) return '加载账户中'
        if (currentAccount !== null && currentAccount.locked) return '账户已锁定，先在账户菜单解锁'
        if (blocked) return '账本异常，需恢复或重置'
        const symbol = form.symbol.trim()
        if (symbol.length < 6) return '输入代码'
        if (String(form.qty).trim() === '') return '填写数量'
        const qty = Number(form.qty)
        if (!Number.isInteger(qty) || qty <= 0) return '数量需为正整数'
        if (form.side === 'buy' && qty % 100 !== 0) return '买入需 100 股整数倍'
        if (form.type === 'limit' && !(Number(form.limitPrice) > 0)) return '填写限价'
        if (session !== null && session.phase === 'auction_close') return '收盘竞价暂不支持模拟撮合'
        if (form.type === 'market' && quote === null && !(Number(form.price) > 0)) return '无行情，请填参考价'
        if (preview !== null && preview.quote?.status === 'suspended') return '停牌'
        if (preview !== null && form.type === 'limit' && preview.priceLimit !== undefined) {
          const price = Number(form.limitPrice)
          if (price < preview.priceLimit.lower || price > preview.priceLimit.upper) return '价格超出涨跌停'
        }
        if (form.side === 'buy' && preview !== null && preview.cashAfterCents < 0) {
          return `资金不足（还差 ${cents(-preview.cashAfterCents)}）`
        }
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
                `${tradeDateText(account.tradeDate, session?.calendar?.source === 'fallback')} · ${session ? PHASE_TEXT[session.phase] : '时段未知'} · 初始 ${money(account.initialCash)}${isFiniteNumber(account.netCashFlow) && account.netCashFlow !== 0 ? ` · 净入金 ${signed(account.netCashFlow)}` : ''} · ${account.blocked ? '已锁定' : '运行中'}`,
                sessionNote(session) !== '' ? h('span', { className: 'pt-note' }, sessionNote(session)) : null,
                session !== null && session !== undefined ? calendarNote(session.calendar) : null,
              ),
            ),
            h('div', { className: 'pt-row' },
              accountSwitch,
              h(AccountPicker, {
                accounts: stockAccounts,
                current: currentAccount,
                busy,
                onSelect: id => setCurrentAccountId(id),
                onCreate: () => setAccountEditor('create'),
                onAction: runAccountAction,
              }),
              h(DataSourceBadge, { status: dataSource }),
              h('button', { className: 'pt-btn', onClick: refreshAll, disabled: busy }, '刷新'),
              h('button', {
                className: 'pt-btn', 'data-active': cashOpen, disabled: busy,
                onClick: () => {
                  setError(null)
                  setCashOpen(value => !value)
                  setResetOpen(false)
                },
              }, '资金'),
              h('button', {
                className: 'pt-btn pt-btn-danger', 'data-active': resetOpen, disabled: busy,
                onClick: () => {
                  setError(null)
                  setResetOpen(value => !value)
                  setResetCash(String(account.initialCash))
                  setCashOpen(false)
                },
              }, '重置'),
              h(FeedbackLink),
            ),
          ),
          h(DataBanner, { status: dataSource, onRetry: refreshAll }),
          cashOpen ? h(CashMovePanel, {
            available: account.cash,
            side: cashSide,
            onSide: setCashSide,
            amount: cashAmount,
            onAmount: setCashAmount,
            busy,
            onCancel: () => {
              setCashOpen(false)
              setCashAmount('')
            },
            onSubmit: moveCash,
          }) : null,
          resetOpen ? h(ResetPanel, {
            initialCash: account.initialCash,
            amount: resetCash,
            onAmount: setResetCash,
            busy,
            onCancel: () => {
              setResetOpen(false)
              setResetCash('')
            },
            onSubmit: reset,
          }) : null,
          accountEditor === null ? null : h(AccountEditor, {
            key: `${accountEditor}:${currentAccountId ?? ''}`,
            mode: accountEditor,
            current: currentAccount,
            busy,
            onCancel: () => setAccountEditor(null),
            onSubmit: submitAccountEditor,
          }),
          account.blocked ? h('div', { className: 'pt-blocked' },
            h('div', { className: 'pt-blocked-text' },
              h('div', null, '账本校验失败，账户已冻结。'),
              account.blockedReason ? h('div', { className: 'pt-blocked-detail', title: account.blockedReason }, `原因：${account.blockedReason}`) : null,
              account.ledgerPath ? h('div', { className: 'pt-blocked-detail', title: account.ledgerPath }, `账本：${account.ledgerPath}`) : null,
              h('div', { className: 'pt-blocked-hint' }, '可让 AI 助手用 paper_ledger 从备份恢复；重置会先备份。'),
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
          h('div', {
            className: 'pt-workspace',
            'data-rail-width': layout.rail === null ? undefined : String(layout.rail),
            'data-rail-collapsed': layout.collapsed ? 'true' : undefined,
            'data-kline-height': layout.klineHeight === 'auto' ? undefined : layout.klineHeight,
            style: layout.rail === null ? undefined : { '--pt-rail-width': `${layout.rail}px` },
          },
            h('div', { className: 'pt-main' },
              h('div', { className: 'pt-tabs' },
                [['trade', '交易'], ['basket', '批量'], ['market', '行情'], ['positions', `持仓 ${positions.length}`], ['orders', `订单 ${pending.length}`], ['review', '复盘'], ['compare', '对比'], ['notes', '笔记']].map(([key, label]) =>
                  h('button', { key, className: 'pt-tab', 'data-active': tab === key, onClick: () => setTab(key) }, label),
                ),
              ),
              h('div', { className: 'pt-tab-body' },
                tab === 'trade' ? h(TradeTab, {
                  account, form, setForm, quote, quoteError, quoteNotice, preview, previewState, previewError,
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
                  runSearch, searchHits, searchAttempted, shortlist, isShortlisted, toggleShortlist,
                  marketList, marketBoard, setMarketBoard, shortlistOnly, setShortlistOnly, loadMarket, busy, adoptQuote, session,
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
                tab === 'compare' ? h(CompareTab, { data: compareData, error: compareError }) : null,
                tab === 'notes' ? h(NotesTab, {
                  text: notes.text,
                  status: notes.status,
                  updatedAt: notes.meta === null ? undefined : notes.meta.updatedAt,
                  error: notes.error,
                  onChange: notes.change,
                  onSave: () => { void notes.flush() },
                  onReload: () => { void notes.reload() },
                  maxBytes: notes.meta === null || notes.meta.maxBytes === undefined ? 100000 : notes.meta.maxBytes,
                }) : null,
              ),
            ),
            h(KlinePane, {
              renderSlot,
              symbol: quote && quote.symbol ? quote.symbol : form.symbol,
              quote,
              bars,
              error: barError,
              interval: barInterval,
              onInterval: setBarInterval,
              onRefresh: () => loadBars(),
              onIdentity: klineIdentity,
              collapsed: layout.collapsed,
              onCollapse: () => applyLayout({ collapsed: true }),
              onExpand: () => applyLayout({ collapsed: false }),
              onRail: value => applyLayout({ rail: value }, false),
              onRailCommit: value => applyLayout({ rail: value }),
              onRailReset: () => applyLayout({ rail: null }),
              height: layout.klineHeight,
              onHeight: value => { if (KLINE_HEIGHTS.includes(value)) applyLayout({ klineHeight: value }) },
            }),
          ),
      )
    }
