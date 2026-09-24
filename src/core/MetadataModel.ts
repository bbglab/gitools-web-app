export type VectorValue = string | number | null

export interface Vector {
  name: string
  values: VectorValue[]
  dataType: 'string' | 'number'
}

export interface MetadataModel {
  size: number
  vectors: Vector[]
  getVector(name: string): Vector | undefined
  addVector(name: string, dataType: 'string' | 'number'): Vector
  getVectorNames(): string[]
}

export class DefaultMetadataModel implements MetadataModel {
  readonly size: number
  readonly vectors: Vector[] = []

  constructor(size: number) {
    this.size = size
  }

  getVector(name: string): Vector | undefined {
    return this.vectors.find(v => v.name === name)
  }

  addVector(name: string, dataType: 'string' | 'number'): Vector {
    const existing = this.getVector(name)
    if (existing) return existing
    const v: Vector = { name, dataType, values: new Array(this.size).fill(null) }
    this.vectors.push(v)
    return v
  }

  getVectorNames(): string[] {
    return this.vectors.map(v => v.name)
  }
}
