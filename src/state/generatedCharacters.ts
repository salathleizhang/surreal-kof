import type { GeneratedCharacterEntry } from '../types/generatedCharacter.ts';

const generatedCharacters = new Map<string, GeneratedCharacterEntry>();

export function getGeneratedCharacter(id: string): GeneratedCharacterEntry | null {
  return generatedCharacters.get(id) || null;
}

export function hasGeneratedCharacter(id: string): boolean {
  return generatedCharacters.has(id);
}

export function registerGeneratedCharacter(entry: GeneratedCharacterEntry): GeneratedCharacterEntry {
  generatedCharacters.set(entry.id, entry);
  return entry;
}

export function listGeneratedCharacters(): GeneratedCharacterEntry[] {
  return [...generatedCharacters.values()];
}

export function listGeneratedCharacterIds(): string[] {
  return [...generatedCharacters.keys()];
}
