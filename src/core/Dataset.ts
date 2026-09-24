import type { MetadataModel } from './MetadataModel'
import { DefaultMetadataModel } from './MetadataModel'

export interface Dataset {
  rowCount: number
  colCount: number
  seriesNames: string[]
  getValue(row: number, col: number, series?: number): number
  setValue(row: number, col: number, value: number, series?: number): void
  getSeriesCount(): number
  addSeries(name: string, dataType?: SeriesDataType): number
  getSeriesArray(series?: number): Float32Array
  rowMetadata: MetadataModel
  colMetadata: MetadataModel
}

export type SeriesDataType = 'Float32' | 'Int16' | 'Int8'

export class DefaultDataset implements Dataset {
  readonly rowCount: number
  readonly colCount: number
  readonly seriesNames: string[] = []
  private readonly seriesArrays: Float32Array[] = []
  rowMetadata: MetadataModel
  colMetadata: MetadataModel

  constructor(rowCount: number, colCount: number, firstName: string, dataType: SeriesDataType = 'Float32') {
    this.rowCount = rowCount
    this.colCount = colCount
    this.rowMetadata = new DefaultMetadataModel(rowCount)
    this.colMetadata = new DefaultMetadataModel(colCount)
    this.addSeries(firstName, dataType)
  }

  getValue(row: number, col: number, series = 0): number {
    return this.seriesArrays[series][row * this.colCount + col]
  }

  setValue(row: number, col: number, value: number, series = 0): void {
    this.seriesArrays[series][row * this.colCount + col] = value
  }

  getSeriesCount(): number {
    return this.seriesArrays.length
  }

  addSeries(name: string, _dataType: SeriesDataType = 'Float32'): number {
    this.seriesNames.push(name)
    this.seriesArrays.push(new Float32Array(this.rowCount * this.colCount))
    return this.seriesNames.length - 1
  }

  // Return the raw typed array for a series — used by the WebGL renderer
  getSeriesArray(series = 0): Float32Array {
    return this.seriesArrays[series]
  }
}
