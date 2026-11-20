/* 35 · hooks — stateful behaviour shared by the stock and futures dashboards. */
    /**
     * Rail width/height preference for one plane.
     *
     * A drag previews in memory and only writes local storage on release, so
     * `applyLayout(patch, false)` stays cheap during a drag.
     */
    function useRailLayout(mode) {
      const [layout, setLayout] = useState(() => readLayout()[mode])
      const applyLayout = useCallback((patch, persist = true) => {
        setLayout(prev => ({ ...prev, ...patch }))
        if (persist) writeLayout(mode, patch)
      }, [mode])
      return [layout, applyLayout]
    }

    /**
     * Run `work` every interval while the document is visible.
     *
     * The host scheduler is the primary matcher; this is only the visible
     * panel's extra trigger, and a hidden panel must not poll.
     */
    function useVisiblePolling(work, intervalMs = 5000) {
      useEffect(() => {
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') void work()
        }, intervalMs)
        return () => clearInterval(timer)
      }, [work, intervalMs])
    }

    /**
     * One account's free-form notes: load on account/tab switch, debounce the
     * edits, flush on the way out. The model has no tool for this text.
     *
     * The in-flight save is stamped with its account id: a response that lands
     * after the panel switched belongs to the old account and must not retarget
     * later flushes.
     */
    function useAccountNotes(accountId, tab) {
      const [text, setText] = useState('')
      const [meta, setMeta] = useState(null)
      const [status, setStatus] = useState('idle')
      const [error, setError] = useState('')
      const textRef = useRef('')
      const timer = useRef(null)
      const ref = useRef({ accountId: null, saved: '' })
      const alive = useRef(true)
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
      }, [])

      const save = useCallback(async (value, id) => {
        if (id === null || id === undefined) return
        setStatus('saving')
        try {
          const view = await rpc('note/set', { text: value }, id)
          if (!alive.current || ref.current.accountId !== id) return
          ref.current = { accountId: id, saved: value }
          setMeta(view)
          setStatus('saved')
          setError('')
        } catch (cause) {
          if (!alive.current || ref.current.accountId !== id) return
          setStatus('error')
          setError(errorOf(cause).text)
        }
      }, [])

      /** Persist a pending edit now; a no-op when nothing changed. */
      const flush = useCallback(async () => {
        if (timer.current !== null) {
          clearTimeout(timer.current)
          timer.current = null
        }
        const { accountId: id, saved } = ref.current
        if (id === null || textRef.current === saved) return
        await save(textRef.current, id)
      }, [save])

      const load = useCallback(async (id, options = {}) => {
        if (id === null) return
        // Switching accounts must not drop the previous account's edit, but an
        // explicit "重新加载" must: discard is what that button promises.
        if (options.discard !== true) await flush()
        else if (timer.current !== null) {
          clearTimeout(timer.current)
          timer.current = null
        }
        ref.current = { accountId: id, saved: '' }
        // Blank the editor while loading: keeping the previous account's text
        // would let a keystroke save it into the new account.
        textRef.current = ''
        setText('')
        setStatus('idle')
        setError('')
        try {
          const view = await rpc('note/get', {}, id)
          if (!alive.current || ref.current.accountId !== id) return
          ref.current = { accountId: id, saved: view.text }
          textRef.current = view.text
          setText(view.text)
          setMeta(view)
        } catch (cause) {
          if (!alive.current) return
          setError(errorOf(cause).text)
        }
      }, [flush])

      const change = useCallback(value => {
        setText(value)
        textRef.current = value
        setStatus('idle')
        if (timer.current !== null) clearTimeout(timer.current)
        const id = ref.current.accountId
        timer.current = setTimeout(() => {
          timer.current = null
          void save(value, id)
        }, 700)
      }, [save])

      useEffect(() => {
        if (accountId !== null) void load(accountId)
      }, [accountId, load])

      useEffect(() => {
        if (tab === 'notes') void load(accountId)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [tab, accountId, load])

      // Leaving the tab (or the panel) within the debounce window still writes.
      useEffect(() => () => {
        if (timer.current !== null) clearTimeout(timer.current)
        void flush()
      }, [flush])

      return {
        text, meta, status, error,
        change, flush, load,
        reload: () => load(accountId, { discard: true }),
      }
    }

    /**
     * The stock account registry and the selected account.
     *
     * One place applies the selection: the module-level `activeAccount` stamps
     * account-scoped requests, so it is set before the reload; per-account view
     * state is cleared so nothing from the previous ledger (a preview, a
     * receipt) survives the switch. The futures ledger is filtered out: this
     * panel only manages stock accounts, and picking futures would fail every
     * request.
     */
    function useAccountRegistry({ tab, loadAll, loadReviewDetail, loadCompare, clearView, setBusy, setError, setNotice, onNotes }) {
      const [accounts, setAccounts] = useState(null)
      const [currentAccountId, setCurrentAccountId] = useState(null)
      const [accountEditor, setAccountEditor] = useState(null)
      const alive = useRef(true)
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
      }, [])

      /** The registry is metadata only: a failure leaves the panel on default. */
      const loadAccounts = useCallback(async () => {
        try {
          const view = await rpc('accounts/list')
          if (!alive.current) return
          setAccounts(view.accounts)
          setCurrentAccountId(previous => {
            if (previous !== null && view.accounts.some(item => item.id === previous)) return previous
            const remembered = view.accounts.find(item => item.id === readCurrentAccount())
            return remembered === undefined ? view.defaultIds.stock : remembered.id
          })
        } catch {
          // Keep whatever is selected; the default account still answers.
        }
      }, [])

      const stockAccounts = useMemo(
        () => (accounts ?? []).filter(item => item.kind === 'stock'),
        [accounts],
      )
      const currentAccount = useMemo(
        () => stockAccounts.find(item => item.id === currentAccountId) ?? null,
        [stockAccounts, currentAccountId],
      )

      useEffect(() => {
        if (currentAccountId === null) return
        activeAccount = currentAccountId
        writeCurrentAccount(currentAccountId)
        clearView()
        void loadAll()
        if (tab === 'review') void loadReviewDetail()
        if (tab === 'compare') void loadCompare()
        // `tab` and `clearView` are read but not dependencies: switching tabs
        // must not re-query, and the clear callback only touches setters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [currentAccountId, loadAll, loadReviewDetail, loadCompare])

      useEffect(() => {
        void loadAccounts()
        return () => { activeAccount = null }
      }, [loadAccounts])

      /** Create/rename go through the registry, then re-read it. */
      const submitAccountEditor = useCallback(async values => {
        if (accountEditor === null) return
        const mode = accountEditor
        setBusy(true)
        try {
          if (mode === 'create') {
            const created = await rpc('accounts/create', {
              name: values.name.trim(),
              ...(values.cash.trim() === '' ? {} : { initialCash: Number(values.cash) }),
            })
            await loadAccounts()
            setNotice(`已创建账户「${created.name}」`)
            activeAccount = created.id
            setCurrentAccountId(created.id)
          } else {
            await rpc('accounts/rename', { id: currentAccountId, name: values.name.trim() })
            await loadAccounts()
            setNotice('账户已改名')
          }
          setAccountEditor(null)
        } catch (cause) {
          setError(errorOf(cause))
        } finally {
          setBusy(false)
        }
      }, [accountEditor, currentAccountId, loadAccounts, setBusy, setError, setNotice])

      /** Picker actions: editor modes open a form, hide/lock apply immediately. */
      const runAccountAction = useCallback(async action => {
        if (currentAccount === null) return
        if (action === 'notes') {
          onNotes()
          return
        }
        if (action === 'create' || action === 'rename') {
          setAccountEditor(action)
          return
        }
        setBusy(true)
        try {
          if (action === 'hide') {
            await rpc('accounts/hide', { id: currentAccount.id })
            setNotice(`已隐藏「${currentAccount.name}」`)
          } else {
            await rpc(currentAccount.locked ? 'accounts/unlock' : 'accounts/lock', { id: currentAccount.id })
            setNotice(currentAccount.locked ? '已解锁账户' : '已锁定账户')
          }
          await loadAccounts()
        } catch (cause) {
          setError(errorOf(cause))
        } finally {
          setBusy(false)
        }
      }, [currentAccount, loadAccounts, onNotes, setBusy, setError, setNotice])

      return {
        accounts, stockAccounts, currentAccountId, setCurrentAccountId, currentAccount,
        accountEditor, setAccountEditor, loadAccounts,
        submitAccountEditor, runAccountAction,
      }
    }
