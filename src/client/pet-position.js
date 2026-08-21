const DEFAULT_MARGIN = 8

/**
 * Keep the pet's interactive character rectangle inside the viewport.
 * `rect` describes the character at `current`; `candidate` is the requested
 * translated offset.
 */
export function clampPetOffset(candidate, current, rect, viewport, margin = DEFAULT_MARGIN) {
  if (!validPoint(candidate) || !validPoint(current) || !validRect(rect)) return current

  const width = Number(viewport?.width)
  const height = Number(viewport?.height)
  if (!(width > 0) || !(height > 0)) return current

  const horizontal = offsetRange(current.x, rect.left, rect.right, width, margin)
  const vertical = offsetRange(current.y, rect.top, rect.bottom, height, margin)
  return {
    x: clamp(candidate.x, horizontal.min, horizontal.max),
    y: clamp(candidate.y, vertical.min, vertical.max),
  }
}

function offsetRange(current, start, end, viewportSize, margin) {
  const safeMargin = Math.max(0, Math.min(Number(margin) || 0, viewportSize / 2))
  const min = current + safeMargin - start
  const max = current + viewportSize - safeMargin - end
  if (min <= max) return { min, max }

  // A scaled character can be larger than a very small viewport. Centering it
  // produces one stable offset instead of alternating between impossible edges.
  const centered = current + viewportSize / 2 - (start + end) / 2
  return { min: centered, max: centered }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function validPoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y)
}

function validRect(rect) {
  return Number.isFinite(rect?.left) && Number.isFinite(rect?.top)
    && Number.isFinite(rect?.right) && Number.isFinite(rect?.bottom)
    && rect.right >= rect.left && rect.bottom >= rect.top
}
