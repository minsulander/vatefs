/**
 * Run: npx tsx src/composables/useAutoFitStripSize.test.ts
 */
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
Object.assign(globalThis, {
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  window: dom.window,
})

if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number
}

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok -', msg)
  }
}

async function main() {
  const {
    collapseStripExpanders,
    getStripExpanderState,
  } = await import('./useStripExpanders.ts')
  const {
    clearStripFitBaseline,
    isStripCompact,
    setStripFitBaseline,
    setStripSizeMode,
  } = await import('./useStripSizeMode.ts')
  const {
    clearAutoFitState,
    contentSpanPx,
    containerOverflows,
    firstInSequenceId,
    freeSpacePx,
    growOrderIds,
    runAutoFitStripSize,
    shrinkOrderIds,
  } = await import('./useAutoFitStripSize.ts')

  // --- preferTop:true — first at visual top (most SAAB bays) ---
  {
    const ids = ['top', 'mid', 'bot']
    assert(
      shrinkOrderIds(ids, true).join(',') === 'bot,mid,top',
      'preferTop shrink starts at bottom (last visual)',
    )
    assert(
      growOrderIds(ids, true).join(',') === 'top,mid,bot',
      'preferTop grow starts at top (first visual)',
    )
    assert(firstInSequenceId(ids, true) === 'top', 'preferTop first = visual top')
  }
  // --- preferTop:false — first at visual bottom (ESSA INBOUND APP ETA / TSAT) ---
  {
    const ids = ['top', 'mid', 'bot']
    assert(
      shrinkOrderIds(ids, false).join(',') === 'top,mid,bot',
      'preferTop:false shrink starts at top (last in sequence)',
    )
    assert(
      growOrderIds(ids, false).join(',') === 'bot,mid,top',
      'preferTop:false grow starts at bottom (first in sequence)',
    )
    assert(firstInSequenceId(ids, false) === 'bot', 'preferTop:false first = visual bottom')
  }

  function makePort(
    clientH: number,
    childHeights: number[],
    opts?: { forceScrollHeight?: number },
  ): HTMLElement {
    const el = document.createElement('div')
    Object.defineProperty(el, 'clientHeight', { get: () => clientH, configurable: true })
    const contentH = childHeights.reduce((a, b) => a + b, 0)
    const scrollH = opts?.forceScrollHeight ?? Math.max(clientH, contentH)
    Object.defineProperty(el, 'scrollHeight', { get: () => scrollH, configurable: true })

    let top = 0
    for (const h of childHeights) {
      const child = document.createElement('div')
      child.className = 'flight-strip'
      const t = top
      Object.defineProperty(child, 'offsetTop', { get: () => t, configurable: true })
      Object.defineProperty(child, 'offsetHeight', { get: () => h, configurable: true })
      Object.defineProperty(child, 'offsetWidth', { get: () => 100, configurable: true })
      el.appendChild(child)
      top += h
    }
    return el
  }

  // --- free space must see slack when scrollHeight === clientHeight ---
  {
    const port = makePort(400, [50, 50, 50])
    assert(port.scrollHeight === 400, 'fixture: scrollHeight equals clientHeight when fitting')
    assert(contentSpanPx(port) === 150, 'contentSpanPx = sum of children')
    assert(freeSpacePx(port) === 250, 'freeSpacePx uses content span, not scrollHeight')
    assert(!containerOverflows(port), 'no overflow when content fits')
  }

  {
    const port = makePort(200, [80, 80, 80])
    assert(containerOverflows(port), 'overflow when content taller than viewport')
    assert(freeSpacePx(port) < 0, 'negative free space when overflowing')
  }

  {
    const port = makePort(400, [50, 50])
    const bogusFree = port.clientHeight - port.scrollHeight
    assert(bogusFree === 0, 'demonstrates scrollHeight free-space bug (== 0)')
    assert(freeSpacePx(port) === 300, 'content-based free space is correct')
  }

  // --- grow-back: compact → normal+expanders when bay has room ---
  const ids = ['a', 'b', 'c']
  for (const id of ids) {
    clearAutoFitState(id)
    clearStripFitBaseline(id)
    collapseStripExpanders(id)
    setStripFitBaseline(id, { compact: false, top: true, bottom: true })
    collapseStripExpanders(id)
    setStripSizeMode(id, 'compact')
    assert(isStripCompact(id), `${id} starts compact`)
  }

  const live = document.createElement('div')
  const liveChildren: HTMLElement[] = []
  let liveClientH = 500

  function heights() {
    return ids.map((id) => {
      if (isStripCompact(id)) return 25
      const exp = getStripExpanderState(id)
      return 50 + (exp.top ? 16 : 0) + (exp.bottom ? 16 : 0)
    })
  }

  function refreshLive() {
    const hs = heights()
    while (liveChildren.length < hs.length) {
      const c = document.createElement('div')
      c.className = 'flight-strip'
      live.appendChild(c)
      liveChildren.push(c)
    }
    let top = 0
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i]!
      const c = liveChildren[i]!
      const t = top
      Object.defineProperty(c, 'offsetTop', { get: () => t, configurable: true })
      Object.defineProperty(c, 'offsetHeight', { get: () => h, configurable: true })
      Object.defineProperty(c, 'offsetWidth', { get: () => 100, configurable: true })
      top += h
    }
    const contentH = top
    Object.defineProperty(live, 'clientHeight', {
      get: () => liveClientH,
      configurable: true,
    })
    Object.defineProperty(live, 'scrollHeight', {
      get: () => Math.max(liveClientH, contentH),
      configurable: true,
    })
  }
  refreshLive()

  const origRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    origRaf(() => {
      refreshLive()
      cb(Date.now())
    }) as unknown as number

  await runAutoFitStripSize({
    container: live,
    visualIds: ids,
    preferTop: true,
    canCompact: () => true,
    allowSizeFit: true,
    growBack: true,
  })

  for (const id of ids) {
    assert(!isStripCompact(id), `${id} grew out of compact`)
    const exp = getStripExpanderState(id)
    assert(!!exp.top && !!exp.bottom, `${id} restored expanders`)
  }

  // --- partial grow when only some slack ---
  for (const id of ids) {
    clearAutoFitState(id)
    setStripFitBaseline(id, { compact: false, top: false, bottom: false })
    collapseStripExpanders(id)
    setStripSizeMode(id, 'compact')
  }
  // 3×25=75; one uncompact → 50+25+25=100. Viewport 110 fits one, not three (150).
  liveClientH = 110
  refreshLive()
  assert(freeSpacePx(live) >= 8, 'compact layout has grow slack')

  await runAutoFitStripSize({
    container: live,
    visualIds: ids,
    preferTop: true,
    canCompact: () => true,
    allowSizeFit: true,
    growBack: true,
  })

  const uncompacted = ids.filter((id) => !isStripCompact(id))
  assert(uncompacted.length >= 1, 'at least one strip grew when slack appeared')
  assert(uncompacted.length < ids.length, 'not all strips grew past capacity')
  // Prefer top: the single grown strip must be first in visual order, not last
  assert(uncompacted[0] === 'a', 'partial grow prefers first visual strip (a), not last')
  assert(isStripCompact('c'), 'last visual strip stays compact when only one fits')

  // --- grow must not skip past a failed strip (no full–compact–full holes) ---
  for (const id of ids) {
    clearAutoFitState(id)
    setStripFitBaseline(id, { compact: false, top: false, bottom: false })
    collapseStripExpanders(id)
    setStripSizeMode(id, 'compact')
  }
  // Room for first uncompact only. If grow skipped mid after a false overflow on
  // 'a', 'c' could incorrectly grow — guard against that hole.
  liveClientH = 110
  refreshLive()
  await runAutoFitStripSize({
    container: live,
    visualIds: ids,
    preferTop: true,
    canCompact: () => true,
    allowSizeFit: true,
    growBack: true,
  })
  assert(!isStripCompact('a'), 'hole-guard: top grew')
  assert(isStripCompact('b'), 'hole-guard: mid stayed compact')
  assert(isStripCompact('c'), 'hole-guard: bottom stayed compact (not promoted)')

  // --- ESSA INBOUND APP: first-in-sequence is visual bottom ---
  for (const id of ids) {
    clearAutoFitState(id)
    setStripFitBaseline(id, { compact: false, top: false, bottom: false })
    collapseStripExpanders(id)
    setStripSizeMode(id, 'compact')
  }
  liveClientH = 110
  refreshLive()
  await runAutoFitStripSize({
    container: live,
    visualIds: ids,
    preferTop: false,
    canCompact: () => true,
    allowSizeFit: true,
    growBack: true,
  })
  assert(!isStripCompact('c'), 'INBOUND: bottom (first in sequence) grew')
  assert(isStripCompact('a'), 'INBOUND: top (last in sequence) stayed compact')
  assert(isStripCompact('b'), 'INBOUND: mid stayed compact')

  if (failed) {
    console.error(`\n${failed} assertion(s) failed`)
    process.exit(1)
  }
  console.log('\nAll auto-fit grow-back checks passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
