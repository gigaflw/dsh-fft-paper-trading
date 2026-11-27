/* 50 · futures — the futures dashboard and its tabs/rail. */

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
      const periodRef = useRef(period)
      useEffect(() => { periodRef.current = period }, [period])
      const reviewSeq = useRef(0)
      const loadAllSeq = useRef(0)
      const [tab, setTab] = useState('trade')
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState(false)
      // Inline cash panel (注资/提款), hidden until the header button is pressed.
      const [cashOpen, setCashOpen] = useState(false)
      const [cashSide, setCashSide] = useState('deposit')
      const [cashAmount, setCashAmount] = useState('')
      const [cashFlow, setCashFlow] = useState([])
      const submitting = useRef(false)
      const placeKey = useRef({ key: '', id: '' })
      const [searchQuery, setSearchQuery] = useState('')
      const [searching, setSearching] = useState(false)
      const [contracts, setContracts] = useState(null)
      const [contractNotice, setContractNotice] = useState('')
      const [contract, setContract] = useState(null)
      const [quote, setQuote] = useState(null)
      const [quoteNotice, setQuoteNotice] = useState('')
      const [dataSource, setDataSource] = useState(null)
      const dataSourceRef = useRef(null)
      const quoteRef = useRef(null)
      const lastTicketRefresh = useRef(0)
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
      const [layout, applyLayout] = useRailLayout('futures')

      const alive = useRef(true)
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
      }, [])

      const loadAll = useCallback(async (quiet = false, reviewPeriod = periodRef.current) => {
        const seq = ++loadAllSeq.current
        const requestedPeriod = reviewPeriod
        try {
          const [nextAccount, nextStatus, nextPositions, nextOrders, nextDataSource] = await Promise.all([
            rpc('futures/account/get'),
            rpc('futures/status'),
            rpc('futures/positions'),
            rpc('futures/orders'),
            rpc('market/data-source'),
          ])
          if (!alive.current) return null
          if (seq === loadAllSeq.current) {
            setAccount(nextAccount)
            setStatus(nextStatus)
            setPositions(nextPositions)
            setOrders(nextOrders)
            setDataSource(nextDataSource)
            dataSourceRef.current = nextDataSource
            if (!quiet) setError(null)
          }
          return { account: nextAccount }
        } catch (cause) {
          if (alive.current && seq === loadAllSeq.current) setError(errorOf(cause))
          return null
        }
      }, [])

      useEffect(() => { loadAll() }, [loadAll])

      const loadReview = useCallback(async (key = period) => {
        const seq = ++reviewSeq.current
        try {
          const [next, nextCash] = await Promise.all([
            rpc('futures/review', { period: key }),
            rpc('futures/cash/flow'),
          ])
          if (alive.current && seq === reviewSeq.current && key === periodRef.current) {
            setReview(next)
            setCashFlow(nextCash)
          }
        } catch (cause) {
          if (alive.current && seq === reviewSeq.current && key === periodRef.current) setError(errorOf(cause))
        }
      }, [])

      useEffect(() => {
        if (tab === 'review') void loadReview()
      }, [tab, loadReview])

      // A period switch reloads the review bundle (account cards included)
      // without touching the ticket, which the old loadAll dependency did by
      // accident. `tab` is read at switch time only.
      const periodMounted = useRef(false)
      useEffect(() => {
        if (!periodMounted.current) {
          periodMounted.current = true
          return
        }
        void loadAll(false, period)
        if (tab === 'review') void loadReview(period)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [period, loadAll, loadReview])

      const fetchQuote = useCallback(async symbol => {
        const seq = ++quoteSeq.current
        try {
          const result = await rpc('futures/quote', { symbols: [symbol] })
          // A slower quote for a previously selected contract must not paint
          // over the one the user is looking at now.
          if (!alive.current || seq !== quoteSeq.current) return
          const nextQuote = result.quotes[0] ?? null
          setQuote(nextQuote)
          setQuoteNotice(nextQuote === null ? (result.notice ?? '取不到行情，可手填参考价') : (result.notice ?? ''))
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
          if (alive.current && tab === 'review') await loadReview(periodRef.current)
          // Keep the selected contract's price and estimate moving while the
          // panel is open; without this the ticket showed the selection price
          // until the next edit. With no quote (free tier or an outage) retry
          // slowly instead of every beat.
          if (!alive.current || contract === null) return
          // A free-tier quote is yesterday's close and does not move: re-price
          // at the degraded cadence instead of spending the 5 s beat. The data
          // source, not the quote object, tells free tier from configured.
          const refreshInterval = dataSourceRef.current?.state === 'configured' ? 5_000 : 300_000
          if (Date.now() - lastTicketRefresh.current >= refreshInterval) {
            lastTicketRefresh.current = Date.now()
            void fetchQuote(contract.symbol)
            setPreviewNonce(value => value + 1)
          }
        } catch {
          // Polling failures stay silent; the manual refresh shows the error.
        }
      }, [loadAll, contract, fetchQuote, tab, loadReview])

      useVisiblePolling(poll)

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
        if (account.blocked === true) return '账本异常，需恢复或重置'
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
        if (!window.confirm('重置期货模拟账户？持仓与挂单会清空；当前账本会先备份，可在备份里找回。')) return
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

      /** 注资/提款只动可用资金；保证金已被持仓占用，提款上限就是可用资金。 */
      const moveCash = useCallback(async () => {
        const cents = cashAmountCents(cashAmount)
        if (cents === null) return
        const amount = cents / 100
        const depositing = cashSide === 'deposit'
        setBusy(true)
        try {
          setAccount(await rpc(depositing ? 'futures/account/deposit' : 'futures/account/withdraw', { amount }))
          await loadAll(true)
          if (tab === 'review') await loadReview(periodRef.current)
          setPreviewNonce(value => value + 1)
          setCashAmount('')
          setCashOpen(false)
          setError(null)
          setNotice(depositing ? `已注资 ${money(amount)}` : `已提款 ${money(amount)}`)
        } catch (cause) {
          setError(errorOf(cause))
        } finally {
          setBusy(false)
        }
      }, [cashAmount, cashSide, loadAll, loadReview, tab])

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
      quoteRef.current = displayQuote
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
              cashFlow,
            })

      return h('div', { className: 'pt-inner' },
        h('div', { className: 'pt-head' },
          h('div', null,
            h('h3', { className: 'pt-title' }, '模拟交易'),
            h('div', { className: 'pt-sub' },
              `期货 · ${tradeDateText(account.tradeDate, status?.calendar?.source === 'fallback')} · ${status ? FUTURES_PHASE_TEXT[status.phase] : '时段未知'} · 初始 ${money(account.initialCash)}${isFiniteNumber(account.netCashFlow) && account.netCashFlow !== 0 ? ` · 净入金 ${signed(account.netCashFlow)}` : ''} · ${account.blocked ? '已锁定' : '运行中'}`,
              status && !status.canSubmit ? h('span', { className: 'pt-note' }, '（当前时段只读）') : null,
              status !== null && status !== undefined ? calendarNote(status.calendar) : null,
            ),
          ),
          h('div', { className: 'pt-head-right' },
            h(BrandPill),
            h('div', { className: 'pt-row' },
              accountSwitch,
              h(DataSourceBadge, { status: dataSource }),
              h('button', { className: 'pt-btn', onClick: refreshAll, disabled: busy }, '刷新'),
              h('button', {
                className: 'pt-btn', 'data-active': cashOpen, disabled: busy,
                onClick: () => {
                  setError(null)
                  setCashOpen(value => !value)
                },
              }, '资金'),
              h('button', { className: 'pt-btn pt-btn-danger', onClick: reset, disabled: busy }, '重置'),
              h(FeedbackLink),
            ),
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
        account.blocked ? h('div', { className: 'pt-blocked' },
          h('div', { className: 'pt-blocked-text' },
            h('div', null, '期货账本校验失败，账户已冻结。'),
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
          statCell('总权益', money(account.equity)),
          statCell('可用资金', money(account.cash)),
          statCell('保证金占用', money(account.margin)),
          statCell('风险度', pct(account.riskRatio), riskWarn ? 'pt-risk-high' : ''),
        ),
        error ? h('div', { className: 'pt-error', title: error.detail || undefined }, error.text) : null,
        notice ? h('div', { className: 'pt-note' }, notice) : null,
        tab === 'trade'
          ? h('div', {
            className: 'pt-workspace pt-workspace-futures',
            'data-rail-width': layout.rail === null ? undefined : String(layout.rail),
            'data-rail-collapsed': layout.collapsed ? 'true' : undefined,
            style: layout.rail === null ? undefined : { '--pt-rail-width': `${layout.rail}px` },
          },
          h('div', { className: 'pt-main' }, tabBar, h('div', { className: 'pt-tab-body' }, tabBody)),
          h(FuturesContractRail, {
            contract,
            quote: displayQuote,
            limit: preview !== null ? preview.limit ?? null : null,
            collapsed: layout.collapsed,
            onCollapse: () => applyLayout({ collapsed: true }),
            onExpand: () => applyLayout({ collapsed: false }),
            onRail: value => applyLayout({ rail: value }, false),
            onRailCommit: value => applyLayout({ rail: value }),
            onRailReset: () => applyLayout({ rail: null }),
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
          contracts !== null && contracts.length > 0 && contractNotice !== ''
            ? h('div', { className: 'pt-note' }, contractNotice)
            : null,
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
                  quote !== null ? h('span', { className: 'pt-note' }, quoteUpdateText(quote)) : null,
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

    function FuturesReviewTab({ review, period, setPeriod, cashFlow }) {
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
          h('div', null,
            h('div', { className: 'pt-sub' }, '资金流水'),
            cashFlow.length === 0 ? h('div', { className: 'pt-empty' }, '暂无流水') : h(Table, null,
              h('thead', null, h('tr', null, ['时间', '类型', '金额', '余额'].map(label => h('th', { key: label }, label)))),
              h('tbody', null, cashFlow.slice(-30).reverse().map((row, index) => h('tr', { key: `${row.ts}-${index}` },
                h('td', null, dateTime(row.ts)),
                h('td', null, FUTURES_CASH_TYPE_TEXT[row.type] ?? row.type),
                h('td', { className: tone(row.amount) }, signed(row.amount)),
                h('td', null, money(row.balance)),
              ))),
            ),
            cashFlow.length > 30 ? h('div', { className: 'pt-note' }, `仅显示最近 30 条，共 ${cashFlow.length} 条`) : null,
          ),
        ) : h('div', { className: 'pt-empty' }, '加载复盘…'),
      )
    }

    /** Right rail for the futures ticket: static terms plus the marked quote. */
    function FuturesContractRail({
      contract, quote, limit, collapsed, onCollapse, onExpand, onRail, onRailCommit, onRailReset,
    }) {
      if (collapsed) return h(CollapsedRail, { label: '合约要素栏', className: 'pt-futures-rail', onExpand })
      return h('aside', { className: 'pt-futures-rail', 'aria-label': '合约要素' },
        h(RailSplitHandle, {
          mode: 'futures', label: '调整合约要素栏宽度',
          onPreview: onRail, onCommit: onRailCommit, onReset: onRailReset,
        }),
        h('div', { className: 'pt-card' },
          h('div', { className: 'pt-card-head' },
            h('div', { className: 'pt-card-title', style: { margin: 0 } }, '合约要素'),
            h(RailToggle, { label: '合约要素栏', onClick: onCollapse }),
          ),
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
