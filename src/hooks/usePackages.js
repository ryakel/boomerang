import { useState, useCallback, useEffect, useRef } from 'react'
import { fetchPackages, createPackage, updatePackage, deletePackageApi, refreshPackage, refreshAllPackages } from '../api'

const CACHE_KEY = 'boom_packages_v1'

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveCache(packages) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(packages))
  } catch { /* quota exceeded — non-fatal */ }
}

export function usePackages() {
  const [packages, setPackages] = useState(() => loadCache())
  const [loading, setLoading] = useState(true)
  const refreshingRef = useRef(false)

  // Wrap setPackages to also persist to localStorage
  const setAndCache = useCallback((updater) => {
    setPackages(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      saveCache(next)
      return next
    })
  }, [])

  const loadPackages = useCallback(async () => {
    try {
      const data = await fetchPackages()
      setAndCache(data)
    } catch (err) {
      console.error('[Packages] Load failed:', err)
      // Keep cached data on failure — don't clear
    } finally {
      setLoading(false)
    }
  }, [setAndCache])

  // Load from localStorage immediately (already in state), then fetch from server,
  // then silently refresh from 17track in background
  useEffect(() => {
    loadPackages().then(() => {
      // Background refresh — don't await, don't block UI
      if (!refreshingRef.current) {
        refreshingRef.current = true
        refreshAllPackages()
          .then(() => loadPackages())
          .catch(() => {})
          .finally(() => { refreshingRef.current = false })
      }
    })
  }, [loadPackages])

  const addPackage = useCallback(async (trackingNumber, label, carrier) => {
    const pkg = await createPackage(trackingNumber, label, carrier)
    setAndCache(prev => [pkg, ...prev])
    return pkg
  }, [setAndCache])

  const editPackage = useCallback(async (id, updates) => {
    const updated = await updatePackage(id, updates)
    setAndCache(prev => prev.map(p => p.id === id ? updated : p))
    return updated
  }, [setAndCache])

  const removePackage = useCallback(async (id) => {
    await deletePackageApi(id)
    setAndCache(prev => prev.filter(p => p.id !== id))
  }, [setAndCache])

  const refresh = useCallback(async (id) => {
    const updated = await refreshPackage(id)
    setAndCache(prev => prev.map(p => p.id === id ? { ...p, ...updated } : p))
    return updated
  }, [setAndCache])

  const hydratePackages = useCallback((serverPackages) => {
    if (Array.isArray(serverPackages)) {
      setAndCache(serverPackages)
    }
  }, [setAndCache])

  const refreshAll = useCallback(async () => {
    const result = await refreshAllPackages()
    await loadPackages()
    return result
  }, [loadPackages])

  return { packages, loading, addPackage, editPackage, removePackage, refresh, refreshAll, loadPackages, hydratePackages }
}
