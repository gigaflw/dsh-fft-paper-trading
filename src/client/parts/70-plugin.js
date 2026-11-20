/* 70 · plugin — sidebar glyph, cordis apply and the exported surface. */

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
      // The sidebar renders this row, so its text is host chrome and follows the
      // host interface language — not the panel copy, which stays Chinese. The
      // host re-reads `label` on every locale change, so a thunk is enough; the
      // two product names match `locale/zh.json` and `locale/en.json`, which
      // carry the same names into the plugin list.
      let hostLocale
      const panelLabel = () => {
        let active
        try {
          active = hostLocale?.getLocale?.().active
        } catch {
          active = undefined
        }
        const tag = active ?? (typeof navigator === 'undefined' ? '' : navigator.language)
        return String(tag).toLowerCase().startsWith('zh') ? '模拟交易' : 'Paper Trading'
      }
      // Optional: hosts without the locale service keep browser-language naming
      // instead of losing the whole client half to an unmet injection.
      ctx.inject(['locale'], scope => {
        const locale = scope.get('locale')
        if (locale === undefined) return () => {}
        hostLocale = locale
        return () => { if (hostLocale === locale) hostLocale = undefined }
      })
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 30,
        label: panelLabel,
      }, PaperGlyph))
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        children: {
          'paperTrading.kline': { kind: 'single', scope: 'root' },
        },
      }, Dashboard))
      // The declared slot stays empty until dsh_kline fills it through its
      // optional host contract; without that plugin (or on an older chart) the
      // rail keeps its built-in simplified chart instead.
      ctx.inject(['klinePanels'], scope => {
        const panels = scope.get('klinePanels')
        if (panels === undefined) return () => {}
        return panels.mount('paperTrading.kline')
      })
    }

    const inject = ['slots']
    exports.apply = apply
    exports.inject = inject
