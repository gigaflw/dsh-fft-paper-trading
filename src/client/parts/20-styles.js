/* 20 · styles — the one CSS block injected into the host shadow root. */

    const CSS = `
      /* Accent comes from the shared FT brand layer; the local aliases keep the
         fallback in one place, so the panel still matches when fft-settings is
         absent. The accent trio follows the brand palette. The soft tint spells
         both values here instead of reading the brand token: the brand layer is
         resolved from the theme's declared colorScheme, while light-dark()
         follows the color-scheme the panel is actually painted with, so a
         custom theme that declares light but paints dark still gets the dark
         tint under its light label text. */
      .pt-root { --pt-accent:var(--ft-accent-warm,light-dark(#cf5623, #ff8352));
        --pt-accent-hover:var(--ft-accent-warm-hover,light-dark(#b8481b, #ff9a72));
        --pt-accent-ink:var(--ft-accent-warm-ink,light-dark(#ffffff, #1a120e));
        --pt-accent-soft:light-dark(#fbeee8, #2b1d16);
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
      /* The badge has no padding of its own and inherits the 1.5 line-height,
         while a button keeps the UA's smaller normal line-height; bottom
         alignment would lift the badge text away from the button labels. Sit on
         the row's centre line instead, the same one the padded buttons use. */
      .pt-source { display:inline-flex; align-items:center; gap:5px; font-size:12px;
        align-self:center; color:var(--dsw-alias-label-secondary, #49525f); white-space:nowrap; }
      .pt-source-dot { width:7px; height:7px; border-radius:50%;
        background:var(--dsw-alias-label-tertiary, #8b93a1); }
      .pt-source[data-state="configured"] .pt-source-dot { background:var(--dsw-alias-state-success-primary, #2f6b47); }
      .pt-source[data-state="free"] .pt-source-dot { background:var(--dsw-alias-state-warn-primary, #8a6410); }
      .pt-source[data-state="invalid"] .pt-source-dot { background:var(--dsw-alias-state-error-primary, #a33b2a); }
      .pt-data-banner { display:flex; gap:10px; justify-content:space-between; align-items:flex-start;
        padding:8px 10px; border-radius:var(--dsw-radius-sm, 8px);
        border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.14));
        border-left:3px solid var(--dsw-alias-label-tertiary, #8b93a1);
        background:var(--dsw-alias-bg-layer-2, #f7f8fa); }
      .pt-data-banner[data-tone="warn"] { border-left-color:var(--dsw-alias-state-warn-primary, #8a6410); }
      .pt-data-banner[data-tone="error"] { border-left-color:var(--dsw-alias-state-error-primary, #a33b2a); }
      .pt-data-banner-title { font-size:12px; font-weight:500; }
      .pt-data-banner-actions { display:flex; gap:6px; flex:0 0 auto; }
      .pt-stats { display:flex; border:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.12));
        border-radius:var(--dsw-radius-sm, 8px); background:var(--dsw-alias-bg-layer-2, #f7f8fa); overflow:hidden; }
      .pt-stat { flex:1 1 0; min-width:0; padding:7px 10px;
        border-right:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.10)); }
      .pt-stat:last-child { border-right:0; }
      .pt-stat-label { font-size:11px; letter-spacing:.04em; color:var(--dsw-alias-label-secondary, #49525f); }
      .pt-stat-value { font-size:16px; font-weight:500; margin-top:1px; font-variant-numeric:tabular-nums;
        font-family:"SF Mono", "JetBrains Mono", Menlo, monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .pt-cash { display:flex; flex-direction:column; gap:8px; padding:8px 10px;
        border:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.12));
        border-radius:var(--dsw-radius-sm, 8px); background:var(--dsw-alias-bg-layer-2, #f7f8fa); }
      .pt-cash .pt-row { align-items:center; }
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
      /* The only anchor styled as a button: a secondary utility, never an
         action, so it sits last in the header row. A normal line-height matches
         the UA default on button, keeping the two the same height. */
      .pt-feedback { text-decoration:none; display:inline-flex; align-items:center; line-height:normal; }
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
      /* A selection is state, not action: the active segment takes the soft
         accent tint plus a thin accent edge, so the only solid orange left on a
         page is the submit button. Same language as .pt-tab / .pt-btn. */
      .pt-seg button[data-active="true"] { background:var(--pt-accent-soft);
        color:var(--dsw-alias-label-primary, #171b22); font-weight:500;
        box-shadow:inset 0 0 0 1px var(--pt-accent); }
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
         stretches to the same bottom edge instead of ending mid-air. The rail
         track is a variable so a drag can pin a px width while the container's
         own clamps stay in charge; the divider rides in the 10px gap. */
      .pt-workspace { --pt-rail: clamp(380px, 38%, 760px);
        display:grid; grid-template-columns:minmax(0, 1fr) var(--pt-rail);
        gap:10px; align-items:stretch; min-width:0; }
      /* 100% is the workspace, so the trading column is guaranteed its 570px
         reserve before the stored rail width is honoured. */
      .pt-workspace[data-rail-width] { --pt-rail: clamp(320px, var(--pt-rail-width), min(760px, calc(100% - 570px))); }
      .pt-main { display:flex; flex-direction:column; gap:10px; min-width:0; min-height:0;
        container:paper-main / inline-size; }
      .pt-tab-body { display:flex; flex-direction:column; gap:10px; flex:1 1 auto; min-height:0; }
      .pt-kline-rail { position:sticky; top:calc(12px + var(--dsh-frame-top-clearance, 0px)); align-self:start; min-width:0; }
      /* The divider sits in the grid gap, so it costs no layout width. The rail
         is positioned (sticky), which anchors the absolutely placed handle. */
      .pt-rail-handle { position:absolute; z-index:3; top:0; bottom:0; left:-10px; width:10px;
        cursor:col-resize; touch-action:none; }
      .pt-rail-handle::before { content:""; position:absolute; left:4px; top:0; bottom:0; width:1px;
        background:transparent; transition:background .12s; }
      .pt-rail-handle:hover::before, .pt-rail-handle[data-dragging="true"]::before { background:var(--pt-accent); }
      .pt-rail-handle:focus-visible { outline:2px solid var(--pt-accent); outline-offset:2px; }
      .pt-resizing, .pt-resizing * { cursor:col-resize !important; user-select:none !important; }
      .pt-rail-actions { display:flex; align-items:center; justify-content:flex-end; gap:6px; flex-wrap:wrap; }
      .pt-icon-btn { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px;
        padding:0; border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.18));
        border-radius:var(--dsw-radius-xs, 4px); background:var(--dsw-alias-bg-layer-1, #fff);
        color:inherit; cursor:pointer; }
      .pt-icon-btn:hover { border-color:var(--pt-accent); color:var(--pt-accent); }
      /* Collapsed rail: a slim strip in wide layouts, a short bar once the panel
         stacks them; either way the rail stays one click away. */
      .pt-rail-collapsed { display:flex; align-items:flex-start; justify-content:center;
        min-height:32px; padding-top:8px; }
      .pt-rail-expand { display:flex; flex-direction:column; align-items:center; gap:6px; padding:4px 0;
        border:0; background:transparent; color:var(--dsw-alias-label-secondary, #49525f); cursor:pointer; }
      .pt-rail-expand:hover { color:var(--pt-accent); }
      .pt-rail-expand-text { writing-mode:vertical-rl; font-size:11px; letter-spacing:.08em; }
      .pt-kline-card { display:flex; flex-direction:column; min-width:0; }
      .pt-kline-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; flex-wrap:wrap; margin-bottom:8px; }
      .pt-kline-title { min-width:0; }
      .pt-kline-body { height:clamp(420px, calc(100vh - 250px), 720px); min-height:0; overflow:hidden;
        border:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.08)); border-radius:var(--dsw-radius-sm, 8px);
        background:var(--dsw-alias-bg-layer-2, #f7f8fa); }
      /* Height presets: the rail body is the only vertical knob that also sizes
         the holdings book (the left column stretches to the rail), so it gets
         two explicit sizes next to the viewport-following default. */
      .pt-workspace[data-kline-height="tall"] .pt-kline-body { height:clamp(520px, calc(100vh - 170px), 820px); }
      .pt-workspace[data-kline-height="full"] .pt-kline-body { height:clamp(420px, calc(100vh - 120px), 1200px); }
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
      /* Direction and quantity read as one row of two halves at every
         breakpoint, so they never split into rows of their own. */
      .pt-field-pair { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr));
        gap:10px 12px; }
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
      .pt-workspace-futures { --pt-rail: clamp(260px, 30%, 400px); }
      .pt-workspace-futures[data-rail-width] { --pt-rail: clamp(240px, var(--pt-rail-width), min(400px, calc(100% - 570px))); }
      /* A stored width survives a collapse (it comes back on expand), so the
         collapsed track has to win the cascade regardless of the drag rule. */
      .pt-workspace[data-rail-collapsed], .pt-workspace-futures[data-rail-collapsed] { --pt-rail: 32px; }
      .pt-futures-rail { position:sticky; top:calc(12px + var(--dsh-frame-top-clearance, 0px)); align-self:start; min-width:0; }
      .pt-card-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
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
        /* Stacked rows own the full width, so a width drag has nothing to do. */
        .pt-rail-handle { display:none; }
        .pt-rail-collapsed { align-items:center; padding:6px 10px; }
        .pt-rail-expand { flex-direction:row; width:100%; justify-content:center; }
        .pt-rail-expand-text { writing-mode:horizontal-tb; }
        .pt-kline-body { height:360px; }
        .pt-workspace[data-kline-height="tall"] .pt-kline-body { height:520px; }
        .pt-workspace[data-kline-height="full"] .pt-kline-body { height:clamp(360px, calc(100vh - 160px), 900px); }
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
      /* ---- multi-account picker ---- */
      .pt-account { position:relative; display:inline-flex; }
      .pt-account-btn { display:inline-flex; align-items:baseline; gap:6px; max-width:280px;
        border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.18));
        background:var(--dsw-alias-bg-layer-1,#fff); color:inherit;
        border-radius:var(--dsw-radius-xs,4px); padding:5px 9px; cursor:pointer;
        font-size:12px; font-family:inherit; }
      .pt-account-btn:hover:not([disabled]) { border-color:var(--pt-accent); }
      .pt-account-btn[data-active="true"] { border-color:var(--pt-accent); background:var(--pt-accent-soft); }
      .pt-account-name { font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .pt-account-note { color:var(--dsw-alias-label-secondary,#49525f); font-size:11px;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:130px; }
      .pt-account-caret { color:var(--dsw-alias-label-secondary,#49525f); font-size:10px; }
      .pt-account-flag { font-size:10px; color:var(--dsw-alias-state-warn-primary,#8a6410); }
      .pt-account-menu { position:absolute; z-index:40; top:calc(100% + 4px); left:0; min-width:232px;
        padding:5px; border-radius:var(--dsw-radius-sm,8px);
        border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.18));
        background:var(--dsw-alias-bg-layer-1,#fff);
        box-shadow:0 10px 28px rgba(0,0,0,.14); }
      .pt-account-list { max-height:280px; overflow:auto; }
      .pt-account-item { display:flex; flex-direction:column; align-items:flex-start; gap:1px; width:100%;
        border:0; background:none; color:inherit; font-family:inherit; text-align:left;
        padding:5px 7px; border-radius:var(--dsw-radius-xs,4px); cursor:pointer; font-size:12px; }
      .pt-account-item:hover { background:var(--dsw-alias-interactive-bg-hover,#eef1f5); }
      .pt-account-item[data-active="true"] { background:var(--pt-accent-soft); }
      .pt-account-item-note { font-size:11px; color:var(--dsw-alias-label-secondary,#49525f);
        max-width:210px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .pt-account-sep { height:0.5px; margin:5px 4px; background:var(--dsw-alias-border-l4, rgba(45,49,66,.12)); }
      .pt-account-action { display:block; width:100%; text-align:left; border:0; background:none; color:inherit;
        font-family:inherit; font-size:12px; padding:5px 7px; border-radius:var(--dsw-radius-xs,4px); cursor:pointer; }
      .pt-account-action:hover { background:var(--dsw-alias-interactive-bg-hover,#eef1f5); }
      /* ---- account notes ---- */
      .pt-notes { display:flex; flex-direction:column; gap:8px; min-width:0; }
      .pt-notes-head { display:flex; gap:10px; align-items:baseline; justify-content:space-between; flex-wrap:wrap; }
      .pt-notes-title { font-size:12px; font-weight:500; }
      .pt-notes-meta { font-size:11px; color:var(--dsw-alias-label-secondary,#49525f); }
      .pt-notes-input { width:100%; min-height:440px; resize:vertical; box-sizing:border-box;
        padding:10px 12px; font-family:inherit; font-size:13px; line-height:1.7; color:inherit;
        background:var(--dsw-alias-bg-layer-2,#f7f8fa);
        border:0.5px solid var(--dsw-alias-border-l2, rgba(45,49,66,.18));
        border-radius:var(--dsw-radius-sm,8px); }
      .pt-notes-input:focus { outline:none; border-color:var(--pt-accent); }
      /* ---- comparison page ---- */
      .pt-compare { display:flex; flex-direction:column; gap:10px; min-width:0; }
      .pt-compare-scroll { overflow-x:auto; min-width:0; }
      .pt-compare-legend { display:flex; flex-wrap:wrap; gap:10px; font-size:11px;
        color:var(--dsw-alias-label-secondary,#49525f); }
      .pt-compare-legend i { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:5px; }
      .pt-compare-table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
      .pt-compare-table th { font-size:11px; font-weight:400; color:var(--dsw-alias-label-secondary,#49525f);
        text-align:right; padding:0 8px 6px; white-space:nowrap; }
      .pt-compare-table th:first-child, .pt-compare-table td:first-child { text-align:left; }
      .pt-compare-table td { padding:6px 8px; border-top:0.5px solid var(--dsw-alias-border-l4, rgba(45,49,66,.10));
        text-align:right; white-space:nowrap; font-size:12px; }
      .pt-compare-table tr[data-lead="true"] td { background:var(--pt-accent-soft); }
      .pt-compare-table th.pt-sortable { cursor:pointer; user-select:none; }
      .pt-compare-table th.pt-sortable:hover { color:var(--pt-accent); }
      .pt-compare-table th[data-sorted="true"] { color:var(--pt-accent); }
      .pt-compare .pt-chart { height:200px; }
      @container paper-panel (max-width: 760px) { .pt-compare .pt-chart { height:150px; } }
      .pt-compare-name { display:flex; flex-direction:column; gap:1px; text-align:left; }
      .pt-compare-note { font-size:11px; color:var(--dsw-alias-label-secondary,#49525f); }
      @container paper-panel (max-width: 760px) {
        .pt-compare-table th:nth-child(8), .pt-compare-table td:nth-child(8) { display:none; }
      }
      .pt-root button:focus-visible, .pt-root input:focus-visible,
      .pt-root .pt-seg button:focus-visible, .pt-root .pt-tab:focus-visible {
        outline:2px solid var(--pt-accent); outline-offset:2px; }
    `
