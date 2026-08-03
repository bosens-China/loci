import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { CloudAdminLoginInput, CloudAdminSession } from '@loci/shared'
import { CloudAdminContext, type CloudAdminContextValue } from './cloud-admin-context'

export function CloudAdminProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [session, setSession] = useState<CloudAdminSession | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void window.api
      .getCloudAdminSession()
      .then((value) => {
        if (active) setSession(value)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const login = useCallback(async (input: CloudAdminLoginInput) => {
    const value = await window.api.cloudAdminLogin(input)
    setSession(value)
    return value
  }, [])

  const logout = useCallback(async () => {
    try {
      await window.api.cloudAdminLogout()
    } finally {
      setSession(null)
    }
  }, [])

  const value = useMemo<CloudAdminContextValue>(
    () => ({ session, loading, login, logout }),
    [loading, login, logout, session]
  )
  return <CloudAdminContext.Provider value={value}>{children}</CloudAdminContext.Provider>
}
