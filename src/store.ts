import * as fs from 'fs'
import * as path from 'path'
import type { CodeUnit } from './types'

function findIndexDir(): string {
  let dir = process.cwd()
  while (true) {
    const candidate = path.join(dir, '.surgex')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break  // reached filesystem root
    dir = parent
  }
  // No existing .surgex found — create it in cwd
  return path.join(process.cwd(), '.surgex')
}

const INDEX_DIR = findIndexDir()
const INDEX_PATH = path.join(INDEX_DIR, 'index.json')

interface StoredUnit extends Omit<CodeUnit, 'id'> {
  id: number
}

interface Index {
  nextId: number
  units: StoredUnit[]
}

function loadIndex(): Index {
  if (!fs.existsSync(INDEX_PATH)) return { nextId: 1, units: [] }
  return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) as Index
}

function saveIndex(index: Index) {
  fs.mkdirSync(INDEX_DIR, { recursive: true })
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index))
}

export function saveUnit(unit: CodeUnit): number {
  const index = loadIndex()
  const id = index.nextId++
  index.units.push({ ...unit, id })
  saveIndex(index)
  return id
}

export function saveUnits(units: CodeUnit[]) {
  const index = loadIndex()
  for (const unit of units) {
    index.units.push({ ...unit, id: index.nextId++ })
  }
  saveIndex(index)
}

export function clearFile(file: string) {
  const index = loadIndex()
  index.units = index.units.filter(u => u.file !== file)
  saveIndex(index)
}

export function clearAll() {
  saveIndex({ nextId: 1, units: [] })
}

export function countUnits(): number {
  return loadIndex().units.length
}

export function getAllUnits(): StoredUnit[] {
  return loadIndex().units
}
