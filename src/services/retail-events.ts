export const RETAIL_DATA_CHANGED = 'vertexia:retail-data-changed'
export const REFRESH_SHIMMER_EVENT = 'vertexia:refresh-shimmer'

export function notifyRetailDataChanged() {
  window.dispatchEvent(new Event(RETAIL_DATA_CHANGED))
}

export function triggerRefreshShimmer() {
  window.dispatchEvent(new Event(REFRESH_SHIMMER_EVENT))
}
