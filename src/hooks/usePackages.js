import { useState, useCallback, useEffect, useRef } from 'react'
import { fetchPackages, createPackage, updatePackage, deletePackageApi, refreshPackage, refreshAllPackages } from '../api'

export function usePackages() {
  const [packages, setPackages] = useState([])
  const [loading, setLoading] = useState(true)
  const refreshingRef = useRef(false)

  const loadPackages = useCallback(async () => {
    try {
      const data = await fetchPackages()
      setPackages(data)
    } catch (err) {
      console.error('[Packages] Load failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Load from DB immediately, then silently refresh from 17track in background
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
    setPackages(prev => [pkg, ...prev])
    return pkg
  }, [])

  const editPackage = useCallback(async (id, updates) => {
    const updated = await updatePackage(id, updates)
    setPackages(prev => prev.map(p => p.id === id ? updated : p))
    return updated
  }, [])

  const removePackage = useCallback(async (id) => {
    await deletePackageApi(id)
    setPackages(prev => prev.filter(p => p.id !== id))
  }, [])

  const refresh = useCallback(async (id) => {
    const updated = await refreshPackage(id)
    setPackages(prev => prev.map(p => p.id === id ? { ...p, ...updated } : p))
    return updated
  }, [])

  const hydratePackages = useCallback((serverPackages) => {
    if (Array.isArray(serverPackages)) {
      setPackages(serverPackages)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    const result = await refreshAllPackages()
    await loadPackages()
    return result
  }, [loadPackages])

  return { packages, loading, addPackage, editPackage, removePackage, refresh, refreshAll, loadPackages, hydratePackages }
}
