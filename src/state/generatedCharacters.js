const generatedCharacters = new Map();

export function getGeneratedCharacter(id) {
  return generatedCharacters.get(id) || null;
}

export function hasGeneratedCharacter(id) {
  return generatedCharacters.has(id);
}

export function registerGeneratedCharacter(entry) {
  generatedCharacters.set(entry.id, entry);
  return entry;
}

export function listGeneratedCharacters() {
  return [...generatedCharacters.values()];
}

export function listGeneratedCharacterIds() {
  return [...generatedCharacters.keys()];
}
