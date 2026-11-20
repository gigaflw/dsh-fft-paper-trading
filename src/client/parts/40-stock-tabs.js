/* 40 · stock tabs — ticket, book, market, positions, orders, review, basket. */

    /* ----------------------------------------------------------- tabs ----- */

    function TradeTab({
      account, form, setForm, quote, quoteError, quoteNotice, preview, previewState, previewError, previewHint,
      busy, onSubmit, submitReason, receipt, positions, pending, onCancel, onSell,
    }) {
      // Default to whichever book has content; the toggle keeps both one click away.
      const [book, setBook] = useState(() => (positions.length === 0 && pending.length > 0 ? 'orders' : 'positions'))
      const maxBuy = preview ? count(preview.maxBuyQty) : '—'
      const priceLabel = form.type === 'limit' ? '限价' : '参考价（可选）'
      const quoteHint = quote
        ? null
        : form.symbol.trim().length < 6
          ? '输入代码后自动取行情'
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
              h(Field, { label: '代码', span: true }, h('input', {
                className: 'pt-input', value: form.symbol, maxLength: 12, spellCheck: false,
                placeholder: '600519 / 000001.SZ',
                onChange: event => setForm(prev => ({ ...prev, symbol: symbolInput(event.target.value) })),
              })),
              h('div', { className: 'pt-span-2 pt-field-pair' },
                h(Field, { label: '方向' }, h('div', { className: 'pt-seg' },
                  [['buy', '买入'], ['sell', '卖出']].map(([key, label]) =>
                    h('button', { key, 'data-active': form.side === key, onClick: () => setForm(prev => ({ ...prev, side: key })) }, label),
                  ),
                )),
                h(Field, { label: '数量（100 股整数倍）' }, h(DebouncedNumber, {
                  value: form.qty, min: 0, step: 100,
                  onChange: value => setForm(prev => ({ ...prev, qty: value })),
                })),
              ),
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
                    h('span', null, `${quote.source === 'daily-bar' ? '收盘' : '现价'} ${money(quote.last)}`),
                    h('span', { className: 'pt-note' }, quoteUpdateText(quote)),
                    h('span', { className: 'pt-note' }, `来源 ${quoteSourceText(quote)}`),
                    quoteNotice !== '' && preview === null ? h('span', { className: 'pt-note' }, quoteNotice) : null,
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
                  h('td', null, position.symbol),
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
                  h('td', null, order.symbol),
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
      const symbol = order.name ? `${order.symbol} ${order.name}` : order.symbol
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
        ? '当前时段不撮合，已受理为下一交易时段开盘委托'
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

    function MarketTab({ searchQuery, setSearchQuery, runSearch, searchHits, searchAttempted, shortlist, isShortlisted, toggleShortlist, marketList, marketBoard, setMarketBoard, shortlistOnly, setShortlistOnly, loadMarket, busy, adoptQuote, session }) {
      const visibleQuotes = marketList === null
        ? []
        : marketList.quotes.filter(item => !shortlistOnly || isShortlisted(item.symbol)).slice(0, 50)
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'pt-card' },
          h('div', { className: 'pt-card-title' }, '搜索标的'),
          h('div', { className: 'pt-row' },
            h('input', {
              className: 'pt-input', style: { flex: 1, minWidth: 200 }, value: searchQuery,
              placeholder: '代码或名称，例如 600519.SH / 贵州茅台',
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
              }, `${hit.symbol} ${hit.name ?? ''}`),
              h('button', { className: 'pt-btn', onClick: () => toggleShortlist(hit.symbol) }, isShortlisted(hit.symbol) ? '已备选' : '加备选'),
            )),
          ) : searchAttempted ? h('div', { className: 'pt-empty', style: { marginTop: 8 } }, '没有找到匹配标的') : null,
        ),
        h('div', { className: 'pt-card' },
          h('div', { className: 'pt-row' },
            h('div', { className: 'pt-card-title', style: { margin: 0 } }, '全市场'),
            [['main', '主板'], ['star', '科创板'], ['chi_next', '创业板'], ['bjse', '北交所'], ['xshg', '沪市'], ['xshe', '深市']].map(([key, label]) =>
              h('button', { key, className: 'pt-btn', 'data-active': marketBoard === key, onClick: () => setMarketBoard(key) }, label),
            ),
            h('button', { className: 'pt-btn', 'data-active': shortlistOnly, onClick: () => setShortlistOnly(value => !value) }, '只看备选'),
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
          marketList !== null && marketList.quotes.length > 0 && marketList.notice
            ? h('div', { className: 'pt-note' }, marketList.notice)
            : null,
          marketList === null ? h('div', { className: 'pt-empty' }, '加载行情…')
            : marketList.quotes.length === 0 ? h('div', { className: 'pt-empty' }, marketList.notice ?? '没有行情')
              : visibleQuotes.length === 0
                ? h('div', { className: 'pt-empty' }, shortlistOnly
                  ? (shortlist.length === 0 ? '还没有备选，点行情行的 ☆ 添加' : '本页没有备选，可翻页或关闭「只看备选」')
                  : '没有行情')
                : h(Table, null,
                h('thead', null, h('tr', null, ['代码', '名称', '现价', '涨跌幅', '备选'].map(label => h('th', { key: label }, label)))),
                h('tbody', null, visibleQuotes.map(item => {
                  const change = item.prevClose && item.prevClose > 0 ? (item.last - item.prevClose) / item.prevClose : null
                  return h('tr', {
                    key: `${item.symbol}-${item.last}`, style: { cursor: 'pointer' },
                    onClick: () => adoptQuote(item.symbol, item),
                  },
                    h('td', null, item.symbol),
                    h('td', null, item.name ?? '—'),
                    h('td', null, money(item.last)),
                    h('td', { className: tone(change ?? 0) }, change === null ? '—' : pct(change)),
                    h('td', null, h('button', { className: 'pt-btn', onClick: event => { event.stopPropagation(); void toggleShortlist(item.symbol) } }, isShortlisted(item.symbol) ? '★' : '☆')),
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
          h('td', null, position.symbol),
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
              h('td', null, order.symbol),
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
            ? h('div', { className: 'pt-note' }, '「待开盘」：当前时段不撮合，下一交易时段开盘后按当时价格尝试成交，可随时撤单。')
            : null,
        ),
        h('div', null,
          h('div', { className: 'pt-sub' }, '历史'),
          history.length === 0 ? h('div', { className: 'pt-empty' }, '无历史订单') : h(Table, null,
            h('thead', null, h('tr', null, ['时间', '代码', '方向', '数量', '限价', '状态', '成交价', '原因', '备注'].map(label => h('th', { key: label }, label)))),
            h('tbody', null, history.slice(0, 30).map(order => h('tr', { key: order.id },
              h('td', null, dateTime(order.createdAt)),
              h('td', null, order.symbol),
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
                h('td', null, trade.symbol),
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
                h('td', null, trip.symbol),
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
        if (preview === null) return '先批量预览'
        if (rows.length === 0) return '没有可下单的行'
        if (preview.session && preview.session.phase === 'auction_close') return '收盘竞价暂不支持模拟撮合'
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
          h('div', { className: 'pt-card-title' }, '批量买入'),
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
            }, busy ? '预览中…' : '批量预览'),
            budgetInvalid ? h('div', { className: 'pt-note pt-risk-high' }, '预算需为正数') : null,
          ),
          h('div', { className: 'pt-note' }, csv.trim() === ''
            ? '先选择 CSV 文件；两列「代码,权重」，最多 20 只'
            : '两列「代码,权重」，最多 20 只，代码写 600519.SH 或 000001.SZ；仅连续竞价时段可下单'),
          error !== '' ? h('div', { className: 'pt-error', style: { marginTop: 8 } }, error) : null,
        ),
        preview !== null ? h('div', { className: 'pt-card' },
          h('div', { className: 'pt-card-title' }, '预览'),
          h(Table, null,
            h('thead', null, h('tr', null,
              ['代码', '名称', '目标权重', '目标金额', '股数', '金额', '费用', '实际权重', '状态'].map(label => h('th', { key: label }, label)),
            )),
            h('tbody', null, preview.rows.map(row => h('tr', { key: row.symbol },
              h('td', null, row.symbol),
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
              h('td', null, row.symbol),
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
