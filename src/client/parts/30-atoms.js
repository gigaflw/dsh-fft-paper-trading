/* 30 · atoms — small components, account picker, comparison, charts, K-line rail. */

    /* ------------------------------------------------------------ atoms --- */

    function Field({ label, children, span = false }) {
      return h('label', { className: span ? 'pt-field pt-span-2' : 'pt-field' }, h('span', null, label), children)
    }

    /**
     * FTShare brand entry in the header's top-right corner.
     *
     * One link carries three surfaces: the mark, a label that flips from the
     * CTA copy to the brand slogan on hover, and the arrow. The idle state is a
     * plain outline on purpose — this is a marketing entry, not a trading
     * control, so it must not read as a filled accent until the pointer is on
     * it. `aria-label` pins the accessible name to the CTA copy: the visible
     * label changes, and a screen reader must not announce the slogan instead.
     */
    const BRAND_LANDING_URL = 'https://ftai.chat/ftshare?utm_source=dsh-fft&utm_medium=AI&utm_campaign=dsh'
    const BRAND_IDLE_COPY = '即刻体验 FtShare'
    const BRAND_HOVER_COPY = '有智能的金融数据'

    /** FTShare mark; the mask keeps the glyphs inside the rounded tile. */
    function BrandMark() {
      return h('svg', {
        className: 'pt-brand-mark', viewBox: '0 0 24.0702 24', 'aria-hidden': 'true', focusable: 'false',
      },
        h('defs', null,
          h('mask', { id: 'pt-brand-mark-tile', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 25, height: 24 },
            h('path', {
              d: 'M19.1579 0H4.91228C2.1993 0 0 2.19289 0 4.89796V19.102C0 21.8071 2.1993 24 4.91228 24H19.1579C21.8709 24 24.0702 21.8071 24.0702 19.102V4.89796C24.0702 2.19289 21.8709 0 19.1579 0Z',
              fill: '#fff',
            }))),
        h('g', { mask: 'url(#pt-brand-mark-tile)' },
          h('path', {
            d: 'M23.5789 0H0.491228C0.21993 0 0 0.219289 0 0.489796V4.40816C0 4.67868 0.21993 4.89796 0.491228 4.89796H23.5789C23.8503 4.89796 24.0702 4.67868 24.0702 4.40816V0.489796C24.0702 0.219289 23.8503 0 23.5789 0Z',
            fill: '#0000FF',
          }),
          h('path', {
            d: 'M24.0702 9.3338C24.0702 8.88801 23.5215 8.67399 23.2182 9.00147L15.5094 17.3232C15.417 17.423 15.2871 17.48 15.1509 17.4806L10.3653 17.5029C10.2291 17.5035 10.0992 17.5606 10.0068 17.6604L4.89504 23.1779C4.6044 23.4916 4.82754 24 5.25587 24H23.579C23.8503 24 24.0702 23.7807 24.0702 23.5102V9.3338Z',
            fill: '#95B6F5',
          }),
          h('path', {
            d: 'M18.8157 8.08163C19.2438 8.08163 19.4671 8.58965 19.1769 8.90346L14.4398 14.0256C14.3468 14.1261 14.2158 14.1833 14.0786 14.1833H9.29548C9.15831 14.1833 9.02737 14.2405 8.93438 14.3411L0.852325 23.0785C0.54909 23.4064 0 23.1925 0 22.7465V8.57143C0 8.30092 0.21993 8.08163 0.491228 8.08163H18.8157Z',
            fill: '#0000FF',
          })),
      )
    }

    /** Header brand entry: mark + label that flips to the slogan on hover. */
    function BrandPill() {
      return h('a', {
        className: 'pt-brand-pill', href: BRAND_LANDING_URL, target: '_blank',
        rel: 'noopener noreferrer', 'aria-label': BRAND_IDLE_COPY,
      },
        h(BrandMark),
        h('span', { className: 'pt-brand-swap', 'aria-hidden': 'true' },
          h('span', { className: 'pt-brand-idle' }, BRAND_IDLE_COPY),
          h('span', { className: 'pt-brand-hover' }, BRAND_HOVER_COPY)),
        h('svg', {
          className: 'pt-brand-arrow', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
          strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
        }, h('path', { d: 'M7 17 17 7M7 7h10v10' })),
      )
    }

    /**
     * Header badge for the data source. `null` until the host has answered, so
     * the header never flashes a guess; a status `message` (failed validation,
     * unreadable settings) is appended to the tooltip only.
     *
     * A recorded quote failure overrides the configuration reading: the badge
     * answers "can quotes be fetched now", and "数据源正常" next to a quota
     * banner would contradict the banner right below it.
     */
    function DataSourceBadge({ status }) {
      if (status === null || status === undefined) return null
      const base = DATA_SOURCE_STATE[status.state] ?? DATA_SOURCE_STATE.none
      const problem = status.problem
      const failure = problem === undefined || problem === null
        ? undefined
        : DATA_PROBLEM_STATE[problem.reason] ?? '取数失败'
      const state = failure === undefined
        ? base
        : { text: `行情${failure}`, title: `最近一次取行情失败：${failure}` }
      const title = state === base && status.message !== undefined && status.message !== ''
        ? `${state.title}（${status.message}）`
        : state.title
      return h('span', {
        className: 'pt-source', 'data-state': status.state, title, 'aria-label': `数据源：${state.text}`,
      },
        h('span', { className: 'pt-source-dot', 'aria-hidden': 'true' }),
        h('span', null, state.text))
    }

    /**
     * Actionable data banner. Dismissal is remembered per reason, so the same
     * cause stays quiet until it changes (then the new reason shows again).
     * The copy names the settings section instead of linking out — see
     * {@link KEY_SETTINGS}.
     */
    function DataBanner({ status, onRetry }) {
      const model = bannerModel(status)
      const [dismissed, setDismissed] = useState(readBannerDismissal)
      if (model === null || model.id === dismissed) return null
      const dismiss = () => {
        try {
          window.localStorage.setItem(DATA_BANNER_DISMISS_KEY, model.id)
        } catch {
          // Private mode: the banner simply reappears next render.
        }
        setDismissed(model.id)
      }
      return h('div', { className: 'pt-data-banner', 'data-tone': model.tone },
        h('div', { style: { minWidth: 0 } },
          h('div', { className: 'pt-data-banner-title' }, model.title),
          h('div', { className: 'pt-note' }, model.detail)),
        h('div', { className: 'pt-data-banner-actions' },
          model.actions.includes('retry')
            ? h('button', { className: 'pt-btn', onClick: onRetry }, '重试')
            : null,
          h('button', { className: 'pt-btn', onClick: dismiss, title: '本类原因不再提示' }, '关闭'),
        ))
    }

    /**
     * Support entry: a plain link to the public issue form. It reads nothing
     * from the ledger, so it is safe to show in every account state — including
     * a blocked one, where a report is most likely needed.
     */
    function FeedbackLink() {
      return h('a', {
        className: 'pt-btn pt-feedback', href: FEEDBACK_URL, target: '_blank', rel: 'noreferrer',
        title: '在 GitHub 报告问题',
      }, '反馈')
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

    /** Yuan text → integer cents, or null when the input is not a usable amount. */
    function cashAmountCents(value) {
      const text = String(value ?? '').trim()
      if (text === '') return null
      const yuan = Number(text)
      if (!Number.isFinite(yuan) || yuan <= 0) return null
      const cents = Math.round(yuan * 100)
      return cents > 0 ? cents : null
    }

    const CASH_QUICK_AMOUNTS = [10000, 50000, 100000]
    const RESET_QUICK_AMOUNTS = [500000, 1000000, 2000000]

    /**
     * Inline cash in/out panel shared by the stock and futures headers.
     *
     * A modal would need focus handling and new CSS; an inline strip reuses the
     * existing `.pt-row`/`.pt-btn` atoms and can show the free-cash limit next to
     * the confirm button.
     */
    function CashMovePanel({ available, side, onSide, amount, onAmount, busy, onCancel, onSubmit }) {
      const cents = cashAmountCents(amount)
      const limitCents = Math.round(available * 100)
      const reason = cents === null ? '金额需为正数' : side === 'withdraw' && cents > limitCents ? '超过可提现金' : ''
      return h('div', { className: 'pt-cash' },
        h('div', { className: 'pt-row' },
          h('button', { className: 'pt-btn', 'data-active': side === 'deposit', onClick: () => onSide('deposit') }, '注资'),
          h('button', { className: 'pt-btn', 'data-active': side === 'withdraw', onClick: () => onSide('withdraw') }, '提款'),
          h('input', {
            className: 'pt-input', style: { width: 130 }, inputMode: 'decimal', placeholder: '金额（元）',
            value: amount, onChange: event => onAmount(event.target.value),
          }),
          CASH_QUICK_AMOUNTS.map(value => h('button', {
            key: value, className: 'pt-btn', onClick: () => onAmount(String(value)),
          }, `${value / 10000}万`)),
          side === 'withdraw' ? h('button', { className: 'pt-btn', onClick: () => onAmount(String(limitCents / 100)) }, '全部') : null,
        ),
        h('div', { className: 'pt-row' },
          h('div', { className: 'pt-note' }, side === 'deposit' ? '注资不计盈亏' : `可提 ${money(available)}，不影响持仓`),
          h('button', { className: 'pt-btn', onClick: onCancel, disabled: busy }, '取消'),
          h('button', {
            className: 'pt-btn pt-btn-primary', onClick: onSubmit, disabled: busy || reason !== '', title: reason || undefined,
          }, busy ? '处理中…' : side === 'deposit' ? '确认注资' : '确认提款'),
        ),
        reason !== '' ? h('div', { className: 'pt-note pt-risk-high' }, reason) : null,
      )
    }

    /**
     * Inline reset confirmation with the starting cash.
     *
     * A reset keeps the previous settings, so an account opened at 10 万 would
     * otherwise stay there forever; the input lets the user pick the starting
     * cash in the same step, and reuses the cash panel's atoms.
     */
    function ResetPanel({ initialCash, amount, onAmount, busy, onCancel, onSubmit }) {
      const cents = cashAmountCents(amount)
      const reason = cents === null ? '初始资金需为正数' : ''
      return h('div', { className: 'pt-cash' },
        h('div', { className: 'pt-row' },
          h('div', { className: 'pt-note' }, '初始资金（元）'),
          h('input', {
            className: 'pt-input', style: { width: 130 }, inputMode: 'decimal', placeholder: `当前 ${money(initialCash)}`,
            value: amount, onChange: event => onAmount(event.target.value),
          }),
          RESET_QUICK_AMOUNTS.map(value => h('button', {
            key: value, className: 'pt-btn', onClick: () => onAmount(String(value)),
          }, `${value / 10000}万`)),
        ),
        h('div', { className: 'pt-row' },
          h('div', { className: 'pt-note' }, '重置会清空持仓与挂单，账本先备份'),
          h('button', { className: 'pt-btn', onClick: onCancel, disabled: busy }, '取消'),
          h('button', {
            className: 'pt-btn pt-btn-danger', onClick: onSubmit, disabled: busy || reason !== '', title: reason || undefined,
          }, busy ? '处理中…' : '确认重置'),
        ),
        reason !== '' ? h('div', { className: 'pt-note pt-risk-high' }, reason) : null,
      )
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

    /** Top-level account switch: the stock and futures ledgers are independent. */
    function AccountSwitch({ mode, onChange }) {
      return h('div', { className: 'pt-seg', role: 'group', 'aria-label': '账户' },
        [['stock', '股票'], ['futures', '期货']].map(([key, label]) =>
          h('button', { key, 'data-active': mode === key, onClick: () => onChange(key) }, label),
        ),
      )
    }

    /* ------------------------------------------------------ multi-account --
       Accounts are a flat registry: a display name, a free text note and two
       flags. Nothing here knows about sessions or models — the panel picks one
       account for the human, and every request names that account explicitly. */

    /**
     * Header picker: current account, the visible account list, then actions.
     * Notes are deliberately absent: they are long-form content, not a label.
     */
    function AccountPicker({ accounts, archived = [], current, busy, onSelect, onCreate, onAction, onRestoreArchived }) {
      const [open, setOpen] = useState(false)
      const rootRef = useRef(null)
      useEffect(() => {
        if (!open) return undefined
        const close = event => {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('mousedown', close, true)
        return () => document.removeEventListener('mousedown', close, true)
      }, [open])
      if (current === null) return null
      return h('div', { className: 'pt-account', ref: rootRef },
        h('button', {
          className: 'pt-account-btn', 'data-active': open ? 'true' : undefined,
          disabled: busy, title: current.name, 'aria-haspopup': 'menu', 'aria-expanded': open ? 'true' : 'false',
          onClick: () => setOpen(value => !value),
        },
          h('span', { className: 'pt-account-name' }, current.name),
          current.locked ? h('span', { className: 'pt-account-flag' }, '锁定') : null,
          h('span', { className: 'pt-account-caret' }, '▾'),
        ),
        open ? h('div', { className: 'pt-account-menu', role: 'menu' },
          accounts.length > 1 ? h('div', { className: 'pt-account-list' }, accounts.map(meta =>
            h('button', {
              key: meta.id, role: 'menuitem', className: 'pt-account-item',
              'data-active': meta.id === current.id ? 'true' : undefined,
              onClick: () => { setOpen(false); if (meta.id !== current.id) onSelect(meta.id) },
            },
              h('span', null, meta.name),
              meta.locked ? h('span', { className: 'pt-account-flag' }, '锁定') : null,
            ))) : null,
          accounts.length > 1 ? h('div', { className: 'pt-account-sep' }) : null,
          archived.length > 0 ? h('div', { className: 'pt-account-sep' }) : null,
          archived.length > 0 ? h('div', { className: 'pt-account-list' }, archived.map(meta =>
            h('button', {
              key: meta.id, role: 'menuitem', className: 'pt-account-item', 'data-archived': 'true', title: '点按恢复归档',
              style: { opacity: 0.7 },
              onClick: () => { setOpen(false); onRestoreArchived(meta.id) },
            },
              h('span', null, meta.name),
              h('span', { className: 'pt-account-item-note' }, '已归档 · 点按恢复'),
            ))) : null,
          archived.length > 0 ? h('div', { className: 'pt-account-sep' }) : null,
          h('button', { className: 'pt-account-action', role: 'menuitem', onClick: () => { setOpen(false); onCreate() } }, '＋ 新建账户'),
          h('button', { className: 'pt-account-action', role: 'menuitem', onClick: () => { setOpen(false); onAction('rename') } }, '重命名'),
          h('button', { className: 'pt-account-action', role: 'menuitem', onClick: () => { setOpen(false); onAction('notes') } }, '笔记'),
          current.id === 'default' ? null : h('button', { className: 'pt-account-action', role: 'menuitem', onClick: () => { setOpen(false); onAction('archive') } }, '归档账户'),
          h('button', { className: 'pt-account-action', role: 'menuitem', onClick: () => { setOpen(false); onAction('lock') } }, current.locked ? '解锁账户' : '锁定账户'),
        ) : null,
      )
    }

    /** Inline create / rename form; the same shape as the cash panel. */
    function AccountEditor({ mode, current, busy, onCancel, onSubmit }) {
      const creating = mode === 'create'
      const [name, setName] = useState(creating || current === null ? '' : current.name)
      const [cash, setCash] = useState('')
      const valid = name.trim() !== ''
      const submit = () => { if (valid) onSubmit({ name, cash }) }
      return h('div', { className: 'pt-cash' },
        h('div', { className: 'pt-row' },
          h(Field, { label: creating ? '账户名' : '新账户名' },
            h('input', {
              className: 'pt-input', value: name, placeholder: '例如：价值组',
              onChange: event => setName(event.target.value),
              onKeyDown: event => { if (event.key === 'Enter') submit() },
            })),
          creating ? h(Field, { label: '初始资金（元，可选）' },
            h('input', {
              className: 'pt-input', type: 'number', min: '1', value: cash, placeholder: '默认 100 万',
              onChange: event => setCash(event.target.value),
            })) : null,
        ),
        h('div', { className: 'pt-row' },
          h('button', { className: 'pt-btn pt-btn-primary', disabled: busy || !valid, onClick: submit }, creating ? '新建' : '保存'),
          h('button', { className: 'pt-btn', disabled: busy, onClick: onCancel }, '取消'),
          creating ? h('span', { className: 'pt-note' }, '新建后自动切换过去') : null,
        ),
      )
    }

    /** Palette for comparison lines; the first entry matches the panel accent. */
    const COMPARE_COLORS = ['#cf5623', '#2e6fa8', '#2f6b47', '#8a6d3b', '#6b4fa8', '#8a3b3b', '#2f7f7f', '#a8552e']

    /**
     * Align every account's daily equity on the union of dates, index each
     * series to 100 at its first day and keep the last known value for days an
     * account has no snapshot. Different starting cash and start dates then
     * still compare honestly.
     */
    function comparisonSeries(rows) {
      const dates = [...new Set(rows.flatMap(row => row.points.map(point => point.date)))].sort()
      if (dates.length < 2) return null
      const series = rows.map(row => {
        const byDate = new Map(row.points.map(point => [point.date, point.equity]))
        let carried = row.points.length > 0 ? row.points[0].equity : 0
        const values = dates.map(date => {
          const value = byDate.get(date)
          if (value !== undefined && value > 0) carried = value
          return carried
        })
        const base = values[0] > 0 ? values[0] : 1
        return values.map(value => (value / base) * 100)
      })
      const flat = series.flat()
      return { dates, series, min: Math.min(...flat), max: Math.max(...flat) }
    }

    function CompareChart({ rows }) {
      // A ledger that never closed a day has no curve; plotting its zeros would
      // drag the shared y-axis down and flatten everybody else.
      const plotted = useMemo(() => rows.filter(row => Array.isArray(row.points) && row.points.length > 0), [rows])
      const aligned = useMemo(() => comparisonSeries(plotted), [plotted])
      if (aligned === null) return h('div', { className: 'pt-empty' }, '至少两个交易日后才有对比曲线')
      const W = 760
      const H = 200
      const PAD = 26
      const { dates, series, min, max } = aligned
      const span = max - min || 1
      const x = index => PAD + (index / (dates.length - 1)) * (W - PAD * 2)
      const y = value => H - PAD - ((value - min) / span) * (H - PAD * 2)
      return h('div', null,
        h('div', { className: 'pt-compare-legend' }, plotted.map((row, index) =>
          h('span', { key: row.id },
            h('i', { style: { background: COMPARE_COLORS[index % COMPARE_COLORS.length] } }),
            row.name))),
        h('svg', { className: 'pt-chart pt-compare-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '账户净值对比' },
          [0, 0.5, 1].map(part => h('line', {
            key: `grid-${part}`, x1: PAD, x2: W - PAD,
            y1: PAD + part * (H - PAD * 2), y2: PAD + part * (H - PAD * 2),
            stroke: 'currentColor', strokeOpacity: 0.12, strokeDasharray: '3 4',
          })),
          series.map((values, index) => h('path', {
            key: `line-${plotted[index].id}`,
            d: values.map((value, at) => `${at === 0 ? 'M' : 'L'}${x(at).toFixed(1)},${y(value).toFixed(1)}`).join(' '),
            fill: 'none',
            stroke: COMPARE_COLORS[index % COMPARE_COLORS.length],
            strokeWidth: index === 0 ? 1.8 : 1.2,
            strokeOpacity: index === 0 ? 1 : 0.8,
          })),
          h('text', { x: PAD, y: PAD - 8, fontSize: 9, fill: 'currentColor', fillOpacity: 0.55 }, max.toFixed(1)),
          h('text', { x: PAD, y: H - 8, fontSize: 9, fill: 'currentColor', fillOpacity: 0.55 }, min.toFixed(1)),
        ),
        h('div', { className: 'pt-note' }, `以各账户首个交易日净值为 100 归一化 · ${dates.length} 个交易日`),
      )
    }

    /**
     * One account's notes: a single long text the human rewrites freely.
     * No history, no timestamps, and no tool — the model cannot reach it.
     */
    function NotesTab({ text, status, updatedAt, maxBytes = 100000, error, onChange, onSave, onReload }) {
      const bytes = typeof text === 'string' ? new TextEncoder().encode(text).length : 0
      const overLimit = bytes > maxBytes
      const statusText = status === 'saving' ? '保存中…' : status === 'saved' ? '已保存' : status === 'error' ? '保存失败' : '自动保存'
      return h('div', { className: 'pt-notes' },
        h('div', { className: 'pt-notes-head' },
          h('span', { className: 'pt-notes-title' }, '账户笔记'),
          h('span', { className: 'pt-notes-meta' }, `${(bytes / 1000).toFixed(1)} / ${(maxBytes / 1000).toFixed(0)} KB · ${statusText}${overLimit ? ' · 超出上限' : ''}`),
        ),
        h('textarea', {
          className: 'pt-notes-input',
          value: text,
          spellCheck: false,
          placeholder: '这个账户想写什么就写什么：策略思路、调仓理由、复盘…… 停止输入后自动保存。',
          onChange: event => onChange(event.target.value),
        }),
        error === '' ? null : h('div', { className: 'pt-error' }, error),
        h('div', { className: 'pt-row' },
          h('button', { className: 'pt-btn', disabled: overLimit, onClick: onSave }, '立即保存'),
          h('button', { className: 'pt-btn', onClick: onReload }, '重新加载'),
          h('span', { className: 'pt-notes-meta' }, updatedAt ? `上次保存 ${dateTime(updatedAt)}` : '还没有保存过'),
        ),
      )
    }

    /** Comparison page: the chart plus the ranking table the human asked for. */
    const COMPARE_COLUMNS = [
      { key: 'name', label: '账户', sortable: true },
      { key: 'initialCash', label: '初始资金', sortable: true },
      { key: 'equity', label: '当前权益', sortable: true },
      { key: 'pnlPct', label: '累计收益', sortable: true },
      { key: 'todayPnl', label: '今日盈亏', sortable: true },
      { key: 'maxDrawdownPct', label: '最大回撤', sortable: true },
      { key: 'tradeCount', label: '成交', sortable: true },
      { key: 'status', label: '状态', sortable: false },
    ]

    function CompareTab({ data, error }) {
      const rows = data === null || data === undefined ? [] : data.accounts
      // Default: return descending. Clicking a header flips direction on the
      // same column and switches columns otherwise, like the review table.
      const [sort, setSort] = useState({ key: 'pnlPct', dir: -1 })
      const sorted = useMemo(() => {
        const value = row => (sort.key === 'name' ? row.name : row[sort.key])
        return [...rows].sort((left, right) => {
          const a = value(left)
          const b = value(right)
          if (typeof a === 'string' || typeof b === 'string') {
            return String(a).localeCompare(String(b), 'zh-CN') * sort.dir
          }
          return (Number(a) - Number(b)) * sort.dir
        })
      }, [rows, sort])
      if (error !== '') return h('div', { className: 'pt-error' }, error)
      if (data === null) return h('div', { className: 'pt-empty' }, '加载账户对比…')
      if (sorted.length < 2) {
        return h('div', { className: 'pt-empty' }, '至少两个账户才有对比。用顶部账户下拉里的「新建账户」添加一个。')
      }
      return h('div', { className: 'pt-compare' },
        h('div', { className: 'pt-compare-scroll' }, h(CompareChart, { rows: sorted })),
        h('div', { className: 'pt-compare-scroll' },
          h('table', { className: 'pt-compare-table' },
            h('thead', null, h('tr', null,
              h('th', { key: '#' }, '#'),
              COMPARE_COLUMNS.map(column => h('th', {
                key: column.key,
                className: column.sortable ? 'pt-sortable' : undefined,
                'data-sorted': sort.key === column.key ? 'true' : undefined,
                onClick: column.sortable
                  ? () => setSort(previous => previous.key === column.key
                    ? { key: column.key, dir: previous.dir === 1 ? -1 : 1 }
                    : { key: column.key, dir: column.key === 'name' ? 1 : -1 })
                  : undefined,
              }, sort.key === column.key ? `${column.label} ${sort.dir === 1 ? '↑' : '↓'}` : column.label)))),
            h('tbody', null, sorted.map((row, index) => h('tr', {
              key: row.id, 'data-lead': index === 0 ? 'true' : undefined,
            },
              h('td', null, String(index + 1)),
              h('td', null, h('div', { className: 'pt-compare-name' }, h('span', null, row.name))),
              h('td', null, money(row.initialCash)),
              h('td', null, money(row.equity)),
              h('td', { className: tone(row.pnlPct) }, pct(row.pnlPct)),
              h('td', { className: tone(row.todayPnl) }, signed(row.todayPnl)),
              h('td', { className: 'pt-down' }, row.maxDrawdownPct > 0 ? `-${(row.maxDrawdownPct * 100).toFixed(1)}%` : '—'),
              h('td', null, count(row.tradeCount)),
              h('td', null, row.missing ? '账本缺失' : row.locked ? '锁定' : '正常'),
            ))),
          )),
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

    /** Elements that prove a slot actually draws something (icons and loading
        text do not count). */
    const PAINTED = 'canvas, iframe, svg, table, video'

    /**
     * Whether a subtree has real rendered content. Open shadow roots belong to
     * that subtree: dsh_kline mounts its whole chart inside
     * `host.attachShadow()`, so a light-DOM query alone reports a perfectly
     * healthy slot as empty.
     */
    function paintsSomething(root) {
      if (root === null || root === undefined || typeof root.querySelector !== 'function') return false
      if (root.querySelector(PAINTED) !== null) return true
      const own = root.shadowRoot
      if (own !== null && own !== undefined && paintsSomething(own)) return true
      for (const node of root.querySelectorAll('*')) {
        const shadow = node.shadowRoot
        if (shadow !== null && shadow !== undefined && paintsSomething(shadow)) return true
      }
      return false
    }

    /** Grace period for a registered slot to paint before the fallback takes
        over. Wall clock, so background timer throttling cannot stretch it. */
    const SLOT_PAINT_TIMEOUT = 6000

    /** Small chevron shared by the rail's collapse and expand controls. */
    function ChevronIcon({ direction }) {
      return h('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
      }, h('path', { d: direction === 'left' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5' }))
    }

    /** Collapse a rail to its slim strip (the strip carries the expand control). */
    function RailToggle({ label, onClick }) {
      return h('button', {
        type: 'button', className: 'pt-icon-btn',
        title: `收起${label}`, 'aria-label': `收起${label}`, 'aria-expanded': 'true',
        onClick,
      }, h(ChevronIcon, { direction: 'right' }))
    }

    /**
     * The collapsed rail: a slim vertical strip, or a short full-width bar once
     * the panel stacks its columns. It keeps the rail one click away instead of
     * leaving an unreachable chart behind a hidden toggle.
     */
    function CollapsedRail({ label, className, onExpand }) {
      return h('aside', { className: `pt-rail-collapsed ${className}`, 'aria-label': label },
        h('button', {
          type: 'button', className: 'pt-rail-expand',
          title: `展开${label}`, 'aria-label': `展开${label}`, 'aria-expanded': 'false',
          onClick: onExpand,
        },
          h(ChevronIcon, { direction: 'left' }),
          h('span', { className: 'pt-rail-expand-text' }, label),
        ),
      )
    }

    /**
     * K-line height presets. The rail body also sets how tall the holdings book
     * gets (the trading column stretches to it), so it is an explicit choice
     * instead of a second drag dimension.
     */
    function HeightPreset({ value, onChange }) {
      return h('div', { className: 'pt-seg', role: 'group', 'aria-label': 'K 线高度' },
        [['auto', '自动'], ['tall', '高'], ['full', '满']].map(([key, text]) =>
          h('button', {
            key, type: 'button', 'data-active': value === key, 'aria-pressed': value === key,
            onClick: () => onChange(key),
          }, text),
        ),
      )
    }

    /**
     * Divider between the trading column and a rail. The rail is the grid's
     * right-hand track, so leftward pointer movement widens it; the px hint is
     * previewed per animation frame and only committed on release. CSS owns the
     * real clamps — this component never decides the final track width.
     * Keyboard follows the host's separators: arrows move 16px, Home/End jump
     * to the limits, Escape and double-click restore the default width.
     */
    function RailSplitHandle({ mode, label, onPreview, onCommit, onReset }) {
      const ref = useRef(null)
      const drag = useRef(null)
      const frame = useRef(0)
      const [dragging, setDragging] = useState(false)
      const limits = RAIL_LIMITS[mode] ?? RAIL_LIMITS.stock

      /** Current rail width in px; the DOM is the source because CSS clamps it. */
      const railWidth = () => {
        const rail = ref.current === null ? null : ref.current.closest('aside')
        return rail === null ? 0 : Math.round(rail.getBoundingClientRect().width)
      }
      /** Keep the trading column its reserve; CSS repeats this clamp for safety. */
      const clampToWorkspace = value => {
        const workspace = ref.current === null ? null : ref.current.closest('.pt-workspace')
        const available = (workspace?.clientWidth ?? 0) - RAIL_MAIN_RESERVE
        const max = Math.min(limits.max, Math.max(limits.min, available))
        return Math.min(max, Math.max(limits.min, Math.round(value)))
      }
      /** End a gesture: a moved width is committed, a plain click is not. */
      const stop = commit => {
        const active = drag.current
        if (active === null) return
        drag.current = null
        if (frame.current !== 0) { window.cancelAnimationFrame(frame.current); frame.current = 0 }
        if (active.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId)
        ref.current?.closest('.pt-root')?.classList.remove('pt-resizing')
        setDragging(false)
        if (commit && active.moved) onCommit(clampToWorkspace(active.latest))
      }
      useEffect(() => () => {
        if (frame.current !== 0) window.cancelAnimationFrame(frame.current)
        ref.current?.closest('.pt-root')?.classList.remove('pt-resizing')
      }, [])
      const preview = width => {
        if (drag.current === null) return
        drag.current.latest = width
        frame.current = window.requestAnimationFrame(() => {
          frame.current = 0
          if (drag.current !== null) onPreview(drag.current.latest)
        })
      }
      const keyStep = step => {
        const next = clampToWorkspace(step(railWidth()))
        onPreview(next)
        onCommit(next)
      }
      return h('div', {
        ref,
        className: 'pt-rail-handle',
        role: 'separator',
        'aria-orientation': 'vertical',
        'aria-label': label,
        'data-dragging': dragging ? 'true' : undefined,
        tabIndex: 0,
        title: '拖动调整宽度，双击恢复默认',
        onPointerDown: event => {
          if (event.button !== 0 || drag.current !== null) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            handle: event.currentTarget,
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: railWidth(),
            latest: railWidth(),
            moved: false,
          }
          ref.current?.closest('.pt-root')?.classList.add('pt-resizing')
          setDragging(true)
        },
        onPointerMove: event => {
          const active = drag.current
          if (active === null || active.pointerId !== event.pointerId) return
          // The rail grows when the divider moves left, hence the inverted delta.
          const delta = active.startX - event.clientX
          // A click is not a drag: without this, touching the divider would pin
          // the responsive percentage width as the current px value.
          if (!active.moved) {
            if (Math.abs(delta) < 3) return
            active.moved = true
          }
          preview(clampToWorkspace(active.startWidth + delta))
        },
        onPointerUp: event => {
          if (drag.current?.pointerId !== event.pointerId) return
          stop(true)
        },
        onPointerCancel: event => {
          if (drag.current?.pointerId === event.pointerId) stop(false)
        },
        onLostPointerCapture: () => stop(true),
        onDoubleClick: onReset,
        onKeyDown: event => {
          if (event.key === 'ArrowLeft') keyStep(width => width + 16)
          else if (event.key === 'ArrowRight') keyStep(width => width - 16)
          else if (event.key === 'Home') keyStep(() => limits.min)
          else if (event.key === 'End') keyStep(() => limits.max)
          else if (event.key === 'Escape') { onReset(); event.preventDefault(); return }
          else return
          event.preventDefault()
        },
      })
    }

    /**
     * Always-visible K-line rail; dsh_kline fills the slot when installed.
     * The slot owns its own interval switch, so the built-in day/minute
     * buttons only exist for the fallback SVG (no dead controls).
     */
    function KlinePane({
      renderSlot, symbol, quote, bars, error, interval, onInterval, onRefresh, onIdentity,
      collapsed, onCollapse, onExpand, onRail, onRailCommit, onRailReset, height, onHeight,
    }) {
      const slot = typeof renderSlot === 'function'
        ? renderSlot('paperTrading.kline', { symbol, onIdentity })
        : null
      const hasSlot = slot !== null && slot !== undefined && slot !== false
        && !(Array.isArray(slot) && slot.length === 0)
      // A registered slot can still render an empty host (no data, failed
      // mount). Poll it briefly; if nothing shows up, fall back to the built-in
      // chart instead of leaving 35% of the panel blank. The timeout is wall
      // clock rather than a tick count: a hidden/occluded window throttles
      // timers to one per second (or per minute), which would otherwise keep
      // the rail on "加载中…" for minutes while a real chart is already drawn.
      const [slotFailed, setSlotFailed] = useState(false)
      const [slotChecking, setSlotChecking] = useState(hasSlot)
      const [slotNonce, setSlotNonce] = useState(0)
      const slotRef = useRef(null)
      useEffect(() => {
        // A collapsed rail unmounts the slot: polling it then would mark a live
        // chart as broken and greet the next expand with the fallback.
        if (!hasSlot || collapsed) return undefined
        setSlotFailed(false)
        setSlotChecking(true)
        const deadline = Date.now() + SLOT_PAINT_TIMEOUT
        const timer = setInterval(() => {
          if (paintsSomething(slotRef.current)) { setSlotChecking(false); clearInterval(timer) }
          else if (Date.now() >= deadline) { setSlotFailed(true); setSlotChecking(false); clearInterval(timer) }
        }, 300)
        return () => clearInterval(timer)
      }, [hasSlot, symbol, slotNonce, collapsed])
      const showFallback = !hasSlot || slotFailed
      if (collapsed) return h(CollapsedRail, { label: 'K 线栏', className: 'pt-kline-rail', onExpand })
      return h('aside', { className: 'pt-kline-rail', 'aria-label': 'K线' },
        h(RailSplitHandle, {
          mode: 'stock', label: '调整 K 线栏宽度',
          onPreview: onRail, onCommit: onRailCommit, onReset: onRailReset,
        }),
        h('div', { className: 'pt-card pt-kline-card' },
          h('div', { className: 'pt-kline-head' },
            h('div', { className: 'pt-kline-title' },
              h('div', { className: 'pt-card-title', style: { margin: 0 } }, `${symbol || '—'} K线`),
              h('div', { className: 'pt-note' }, quote ? `${symbolText(quote)} · ${quote.source === 'daily-bar' ? '收盘' : '现价'} ${money(quote.last)}` : '等待行情'),
            ),
            h('div', { className: 'pt-rail-actions' },
              showFallback ? h('div', { className: 'pt-row', style: { flexWrap: 'nowrap', alignItems: 'center' } },
                h('div', { className: 'pt-seg' },
                  [['day', '日K'], ['minute', '分时']].map(([key, label]) =>
                    h('button', { key, 'data-active': interval === key, onClick: () => onInterval(key) }, label),
                  ),
                ),
                h('button', { className: 'pt-btn', onClick: onRefresh }, '刷新'),
              ) : null,
              h(HeightPreset, { value: height, onChange: onHeight }),
              h(RailToggle, { label: 'K 线栏', onClick: onCollapse }),
            ),
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
