/**
 * IndexedDB 只存两样东西：
 * 1) 上次解析出的 Dataset —— 重开页面立刻有图，不用再选目录；
 * 2) 上次的目录 handle —— 授权仍在时可一键重扫（否则静默回落到"重选目录"）。
 * 不存任何消息正文；快照本身也不含正文。
 */
const DB_NAME = 'cb-usage'
const STORE = 'kv'
const VERSION = 1

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await open()
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as T) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    /* 隐私模式下可能不可用，忽略 */
  }
}

export async function idbDel(key: string): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    /* ignore */
  }
}

const DARK_KEY = 'cb-dark'
const AUTO_KEY = 'cb-auto-refresh'

export const prefs = {
  theme(): 'dark' | 'light' {
    try {
      const v = localStorage.getItem(DARK_KEY)
      if (v === 'dark' || v === 'light') return v
    } catch {
      /* ignore */
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  },
  setTheme(v: 'dark' | 'light') {
    try {
      localStorage.setItem(DARK_KEY, v)
    } catch {
      /* ignore */
    }
  },
  autoRefresh(): boolean {
    try {
      return localStorage.getItem(AUTO_KEY) === '1'
    } catch {
      return false
    }
  },
  setAutoRefresh(v: boolean) {
    try {
      localStorage.setItem(AUTO_KEY, v ? '1' : '0')
    } catch {
      /* ignore */
    }
  },
}
