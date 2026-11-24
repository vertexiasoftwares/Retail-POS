import { useAuth } from '../../app/auth/useAuth'
import { useState } from 'react'
export function BusinessName() { return <>{useAuth().session!.businessName}</> }
export function BranchName() { const { session } = useAuth(); return <>{session!.branches.find(branch => branch.id === session!.branchId)?.name}</> }
export function UserName() { return <>{useAuth().session!.name}</> }
export function UserRoleName() { return <>{useAuth().session!.role}</> }
export function SessionBar() {
  const { session, logout, selectBranch } = useAuth()
  const [error, setError] = useState('')
  return <div className="session-bar"><span><strong>{session!.businessName}</strong><span>{session!.name} · {session!.role}</span><select aria-label="Working branch" value={session!.branchId} onChange={event => { setError(''); void selectBranch(event.target.value).catch(cause => setError(String(cause))) }}>{session!.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name} · {branch.code}</option>)}</select>{error && <span role="alert">{error}</span>}</span><button onClick={() => void logout().catch(cause => setError(String(cause)))}>Sign out</button></div>
}
import { TopNavHeader } from './TopNavHeader'

export function IdentityHeader({ onNavigate }: { onMenu?: () => void; onNavigate?: (page: string) => void }) {
  return (
    <TopNavHeader
      title="My Account"
      subtitle="Local user profile and security"
      onNavigate={onNavigate}
    />
  )
}
