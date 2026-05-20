import React, { useEffect, useMemo, useState } from 'react'

const DB_NAME = 'hags-shop-db'
const STORE_PRODUCTS = 'products'
const STORE_META = 'meta'
const DEFAULT_PASSWORD = 'admin1234'

const emptyForm = { code: '', name: '', price: '', note: '' }
const seedProducts = [
  { code: '5012345678901', name: 'Whole Milk 2L', price: 1.85, note: 'Chilled aisle' },
  { code: '5053990156009', name: 'AA Batteries 4 Pack', price: 4.5, note: 'Electrical shelf' },
  { code: '9780141036144', name: 'Paperback book', price: 9.99, note: 'General shelf' }
]

function normalizeCode(value) { return String(value || '').trim() }
function money(value) { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value || 0)) }
function csvEscape(value) { const s = String(value ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
function parseCsvLine(line) { let cur = '', out = [], q = false; for (let i = 0; i < line.length; i++) { const c = line[i], n = line[i + 1]; if (c === '"') { if (q && n === '"') { cur += '"'; i++ } else q = !q } else if (c === ',' && !q) { out.push(cur); cur = '' } else cur += c } out.push(cur); return out.map(v => v.trim()) }

function App() {
  const [mode, setMode] = useState('public')
  const [adminReady, setAdminReady] = useState(false)
  const [password, setPassword] = useState('')
  const [products, setProducts] = useState([])
  const [basket, setBasket] = useState([])
  const [scan, setScan] = useState('')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [activeCode, setActiveCode] = useState('')
  const [status, setStatus] = useState('')
  const [storageMode, setStorageMode] = useState('loading')
  const [theme, setTheme] = useState('light')
  const [adminHash, setAdminHash] = useState(null)
  const [adminSalt, setAdminSalt] = useState(null)
  const [db, setDb] = useState(null)

  const isDark = theme === 'dark'
  const visibleProducts = useMemo(() => products.filter(p => [p.code, p.name, p.note].join(' ').toLowerCase().includes(search.toLowerCase())), [products, search])
  const basketTotal = basket.reduce((sum, item) => sum + item.qty * item.price, 0)
  const basketCount = basket.reduce((sum, item) => sum + item.qty, 0)

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])

  useEffect(() => { (async () => {
    if (window.indexedDB) {
      try {
        const opened = await new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, 1)
          req.onupgradeneeded = () => {
            const d = req.result
            if (!d.objectStoreNames.contains(STORE_PRODUCTS)) d.createObjectStore(STORE_PRODUCTS, { keyPath: 'code' })
            if (!d.objectStoreNames.contains(STORE_META)) d.createObjectStore(STORE_META, { keyPath: 'key' })
          }
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        })
        setDb(opened)
        setStorageMode('indexedDB')
      } catch {
        setStorageMode('memory')
      }
    } else {
      try { localStorage.setItem('__test__', '1'); localStorage.removeItem('__test__'); setStorageMode('localStorage') } catch { setStorageMode('memory') }
    }
  })() }, [])

  useEffect(() => { (async () => {
    if (db) {
      const list = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PRODUCTS, 'readonly')
        const req = tx.objectStore(STORE_PRODUCTS).getAll()
        req.onsuccess = () => resolve(req.result || [])
        req.onerror = () => reject(req.error)
      })
      setProducts(list)
    } else if (storageMode === 'localStorage') {
      setProducts(JSON.parse(localStorage.getItem('hags-products') || '[]'))
    } else {
      setProducts([])
    }
  })() }, [db, storageMode])

  useEffect(() => { (async () => {
    if (db) {
      const getMeta = key => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readonly')
        const req = tx.objectStore(STORE_META).get(key)
        req.onsuccess = () => resolve(req.result?.value ?? null)
        req.onerror = () => reject(req.error)
      })
      let salt = await getMeta('adminSalt')
      let hash = await getMeta('adminHash')
      if (!salt || !hash) {
        salt = crypto.getRandomValues(new Uint8Array(16)).reduce((a, b) => a + b.toString(16).padStart(2, '0'), '')
        hash = await hashPassword(DEFAULT_PASSWORD, salt)
        const putMeta = (key, value) => new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_META, 'readwrite')
          tx.objectStore(STORE_META).put({ key, value })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
        await putMeta('adminSalt', salt)
        await putMeta('adminHash', hash)
      }
      setAdminSalt(salt); setAdminHash(hash)
    }
  })() }, [db])

  async function hashPassword(value, salt) {
    const enc = new TextEncoder()
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(value), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 200000, hash: 'SHA-256' }, keyMaterial, 256)
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  async function persist(nextProducts) {
    if (db) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PRODUCTS, 'readwrite')
        const store = tx.objectStore(STORE_PRODUCTS)
        store.clear()
        nextProducts.forEach(p => store.put(p))
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
      })
    } else if (storageMode === 'localStorage') {
      localStorage.setItem('hags-products', JSON.stringify(nextProducts))
    }
    setProducts(nextProducts)
  }

  function productByCode(code) { return products.find(p => p.code === normalizeCode(code)) }

  function addToBasket(code) {
    const p = productByCode(code)
    if (!p) { setStatus(`Barcode ${normalizeCode(code)} is not mapped.`); return }
    setBasket(curr => { const found = curr.find(x => x.code === p.code); return found ? curr.map(x => x.code === p.code ? { ...x, qty: x.qty + 1 } : x) : [...curr, { code: p.code, name: p.name, price: Number(p.price || 0), qty: 1 }] })
    setScan('')
    setStatus(`Added ${p.name}.`)
  }

  async function unlock() {
    if (!adminSalt || !adminHash) return
    const entered = await hashPassword(password, adminSalt)
    if (entered === adminHash) { setAdminReady(true); setMode('admin'); setPassword(''); setStatus('Signed in.') } else setStatus('Wrong password.')
  }

  async function saveForm() {
    const item = { code: normalizeCode(form.code), name: form.name.trim(), price: Number(form.price || 0), note: form.note.trim() }
    if (!item.code || !item.name) return
    const next = products.some(p => p.code === item.code) ? products.map(p => p.code === item.code ? item : p) : [...products, item]
    setActiveCode(item.code)
    await persist(next)
    setStatus('Item saved.')
  }

  async function removeProduct(code) {
    const next = products.filter(p => p.code !== normalizeCode(code))
    await persist(next)
    setBasket(curr => curr.filter(x => x.code !== normalizeCode(code)))
    if (activeCode === code) setForm(emptyForm)
    setStatus('Item removed.')
  }

  function editProduct(code) {
    const p = productByCode(code)
    if (!p) return
    setForm({ code: p.code, name: p.name, price: p.price, note: p.note || '' })
    setActiveCode(p.code)
  }

  function exportCsv() {
    const rows = [['code', 'name', 'price', 'note'], ...products.map(p => [p.code, p.name, Number(p.price || 0).toFixed(2), p.note || ''])]
    const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n')
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'hags-products.csv')
  }

  function exportJson() {
    download(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), products }, null, 2)], { type: 'application/json' }), 'hags-products.json')
  }

  function download(blob, name) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function importFile(file) {
    file.text().then(text => {
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(text)
        const list = Array.isArray(parsed) ? parsed : parsed.products
        if (Array.isArray(list)) persist(list.map(p => ({ code: normalizeCode(p.code), name: String(p.name || p.description || ''), price: Number(p.price || 0), note: String(p.note || p.notes || '') })).filter(p => p.code && p.name))
      } else {
        const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        const start = (lines[0] || '').toLowerCase().includes('code') ? 1 : 0
        const list = []
        for (let i = start; i < lines.length; i++) {
          const [code, name, price, note] = parseCsvLine(lines[i])
          if (code && name) list.push({ code: normalizeCode(code), name, price: Number(price || 0), note: note || '' })
        }
        persist(list)
      }
    })
  }

  const openBasketTotal = basketTotal.toFixed(2)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">H</div>
          <div>
            <h1>H.A.G.S.</h1>
            <p className="sub">Scan items into the basket, or sign in to add and edit shop items.</p>
          </div>
        </div>
        <div className="toolbar">
          <button className={mode === 'public' ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => setMode('public')}>Checkout</button>
          <button className={mode === 'admin' ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => setMode('admin')}>Shopkeeper</button>
          <button className="btn btn-secondary" onClick={() => setTheme(isDark ? 'light' : 'dark')}>{isDark ? 'Light' : 'Dark'}</button>
        </div>
      </header>

      <section className="stats">
        <div className="stat"><span className="muted">Items</span><strong>{products.length}</strong></div>
        <div className="stat"><span className="muted">Lines</span><strong>{basket.length}</strong></div>
        <div className="stat"><span className="muted">In basket</span><strong>{basketCount}</strong></div>
        <div className="stat"><span className="muted">Total</span><strong>{money(basketTotal)}</strong></div>
      </section>

      {mode === 'public' ? (
        <section className="layout">
          <div className="panel">
            <div className="panel-head"><div><h2>Scan an item</h2><p className="muted">Scan a barcode to add the item to the basket.</p></div><span className="pill">Public</span></div>
            <div className="panel-body">
              <label className="label">Scan code<input autoFocus value={scan} onChange={e => setScan(e.target.value)} onKeyDown={e => e.key === 'Enter' && addToBasket(scan)} placeholder="Scan or type here" inputMode="numeric" /></label>
              <div className="toolbar"><button className="btn btn-primary" onClick={() => addToBasket(scan)}>Add to basket</button><button className="btn btn-secondary" onClick={() => setScan('')}>Clear</button><button className="btn btn-secondary" onClick={() => setBasket([])}>Empty basket</button></div>
              <div className="card">{status || 'Scan a known item to add it to the basket.'}</div>
            </div>
          </div>
          <div className="panel right-panel">
            <div className="panel-head"><div><h2>Basket</h2><p className="muted">Update quantities or remove items.</p></div><span className="pill">Live</span></div>
            <div className="panel-body">
              <div className="list basket-list">
                {basket.length ? basket.map(item => (
                  <div className="row" key={item.code}>
                    <div className="flex-between"><div><strong>{item.name}</strong><div className="helper">{item.code}</div></div><strong>{money(item.qty * item.price)}</strong></div>
                    <div className="toolbar">
                      <button className="btn btn-secondary" onClick={() => setBasket(curr => curr.map(x => x.code === item.code ? { ...x, qty: Math.max(1, x.qty - 1) } : x))}>−</button>
                      <span>Qty {item.qty}</span>
                      <button className="btn btn-secondary" onClick={() => setBasket(curr => curr.map(x => x.code === item.code ? { ...x, qty: x.qty + 1 } : x))}>+</button>
                      <button className="btn btn-danger" onClick={() => setBasket(curr => curr.filter(x => x.code !== item.code))}>Remove</button>
                    </div>
                  </div>
                )) : <div className="muted">No items in the basket yet.</div>}
              </div>
              <div className="basket-footer card">
                <div className="flex-between"><span className="muted">Items</span><strong>{basketCount}</strong></div>
                <div className="flex-between"><span className="muted">Total</span><strong>{money(basketTotal)}</strong></div>
                <div className="toolbar sticky-actions"><button className="btn btn-secondary" onClick={() => setBasket([])}>Clear basket</button><button className="btn btn-primary" onClick={() => setScan('')}>Ready for next scan</button></div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="layout">
          <div className="panel">
            <div className="panel-head"><div><h2>Shopkeeper sign-in</h2><p className="muted">Sign in to manage the shop list.</p></div><span className="pill">Private</span></div>
            <div className="panel-body">
              {!adminReady ? (
                <>
                  <div className="card">First password: <strong>admin1234</strong>. Change it after first sign-in.</div>
                  <label className="label">Shopkeeper password<input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && unlock()} placeholder="Password" /></label>
                  <div className="toolbar"><button className="btn btn-primary" onClick={unlock}>Sign in</button></div>
                </>
              ) : (
                <>
                  <div className="toolbar"><button className="btn btn-secondary" onClick={() => setAdminReady(false)}>Lock</button><button className="btn btn-secondary" onClick={() => setMode('public')}>Checkout</button><button className="btn btn-secondary" onClick={() => persist(seedProducts)}>Load example</button><button className="btn btn-primary" onClick={exportCsv}>Export CSV</button></div>
                  <div className="section">
                    <h3>Add or edit an item</h3>
                    <div className="form-grid">
                      <label className="label">Item code<input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="Item code" /></label>
                      <label className="label">Item name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Item name" /></label>
                      <label className="label">Price<input type="number" step="0.01" min="0" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="0.00" /></label>
                      <button className="btn btn-primary" onClick={saveForm}>Save</button>
                    </div>
                    <label className="label">Notes<textarea rows="3" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Notes"></textarea></label>
                    <div className="toolbar"><button className="btn btn-secondary" onClick={() => setForm(emptyForm)}>Clear</button><button className="btn btn-danger" onClick={() => removeProduct(activeCode || form.code)}>Remove</button><button className="btn btn-secondary" onClick={exportJson}>Backup JSON</button><label className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center' }}>
                      Import CSV/JSON<input type="file" accept=".csv,.json" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = '' }} />
                    </label></div>
                  </div>
                  <div className="section">
                    <h3>Change sign-in password</h3>
                    <label className="label">New password<input id="newPassword" type="password" placeholder="At least 8 characters" /></label>
                    <button className="btn btn-secondary" onClick={async () => { const val = document.getElementById('newPassword').value.trim(); if (val.length < 8) return setStatus('Use at least 8 characters.'); const salt = crypto.getRandomValues(new Uint8Array(16)).reduce((a, b) => a + b.toString(16).padStart(2, '0'), ''); const hash = await hashPassword(val, salt); if (db) { const tx = db.transaction(STORE_META, 'readwrite'); tx.objectStore(STORE_META).put({ key: 'adminSalt', value: salt }); tx.objectStore(STORE_META).put({ key: 'adminHash', value: hash }); } else if (storageMode === 'localStorage') { const meta = JSON.parse(localStorage.getItem('hags-meta') || '{}'); meta.adminSalt = salt; meta.adminHash = hash; localStorage.setItem('hags-meta', JSON.stringify(meta)) } setAdminSalt(salt); setAdminHash(hash); document.getElementById('newPassword').value = ''; setStatus('Password updated.'); }}>Update password</button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><div><h2>Shop items</h2><p className="muted">Search and edit items used on the checkout page.</p></div></div>
            <div className="panel-body">
              <label className="label">Search<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items" /></label>
              <div className="list">
                {visibleProducts.length ? visibleProducts.map(item => (
                  <div className="row" key={item.code}>
                    <div className="flex-between"><div><strong>{item.name}</strong><div className="helper">{item.code} · {money(item.price)}</div><div className="helper">{item.note || ''}</div></div><div className="toolbar"><button className="btn btn-secondary" onClick={() => editProduct(item.code)}>Edit</button><button className="btn btn-danger" onClick={() => removeProduct(item.code)}>Remove</button></div></div>
                  </div>
                )) : <div className="muted">No items found.</div>}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

export default App