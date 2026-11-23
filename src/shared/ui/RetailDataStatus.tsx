import { useRetailData } from '../../app/data/useRetailData'
import './retail-data-status.css'

export function RetailDataStatus() {
  const { loading, error, refresh } = useRetailData()
  return <>
    {loading && <div className="retail-data-status" role="status">Loading shop records…</div>}
    {error && <div className="retail-data-status error" role="alert">{error}<button onClick={() => void refresh()}>Retry</button></div>}
  </>
}
