// Portions derived from Morpheus.js
// Copyright (c) 2017, Connectivity Map and LINCS at the Broad Institute
// BSD 3-Clause License — see LICENSE.morpheus in the project root

/**
 * Maps data indices (rows or columns) to pixel positions and back.
 * Used to cull the viewport — only indices visible in the current
 * scroll window are rendered.
 */
export class Positions {
  private readonly sizes: Float32Array
  private readonly cumulative: Float32Array  // length = count + 1
  private readonly count: number

  constructor(count: number, defaultSize = 14) {
    this.count = count
    this.sizes = new Float32Array(count).fill(defaultSize)
    this.cumulative = new Float32Array(count + 1)
    this.recalculate()
  }

  private recalculate(): void {
    this.cumulative[0] = 0
    for (let i = 0; i < this.count; i++) {
      this.cumulative[i + 1] = this.cumulative[i] + this.sizes[i]
    }
  }

  getSize(index: number): number {
    return this.sizes[index]
  }

  setSize(index: number, size: number): void {
    this.sizes[index] = size
    this.recalculate()
  }

  setAllSizes(size: number): void {
    this.sizes.fill(size)
    this.recalculate()
  }

  /** Pixel offset of the left/top edge of this index */
  getPosition(index: number): number {
    return this.cumulative[index]
  }

  getTotalSize(): number {
    return this.cumulative[this.count]
  }

  getCount(): number {
    return this.count
  }

  /**
   * First index whose cell overlaps or starts at/after pixelOffset.
   * Binary search — O(log n).
   */
  getStart(pixelOffset: number): number {
    if (pixelOffset <= 0) return 0
    let lo = 0
    let hi = this.count - 1
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.cumulative[mid + 1] <= pixelOffset) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    return lo
  }

  /**
   * One-past-last index whose cell overlaps the range [pixelOffset, pixelOffset+length).
   * Binary search — O(log n).
   */
  getEnd(pixelOffset: number, length: number): number {
    const endPixel = pixelOffset + length
    let lo = 0
    let hi = this.count
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.cumulative[mid] < endPixel) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    return Math.min(this.count, lo)
  }
}
