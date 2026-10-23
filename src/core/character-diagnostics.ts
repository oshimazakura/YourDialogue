import type { Character } from '../shared/types.ts';

const string = (value: unknown, limit = 100000) =>
  typeof value === 'string' ? value.slice(0, limit) : '';
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// Project only known settings. Never retain arbitrary renderer payloads or original card blobs.
export function diagnosticCharacter(input: unknown): Character {
  const value = object(input);
  const card = object(value.importedCard);
  return {
    id: string(value.id, 80),
    name: string(value.name, 120),
    description: string(value.description),
    personality: string(value.personality),
    scenario: string(value.scenario),
    exampleMessages: string(value.exampleMessages),
    greeting: string(value.greeting),
    defaultExpression: string(value.defaultExpression, 80),
    background: string(value.background, 300),
    expressions: (Array.isArray(value.expressions) ? value.expressions : [])
      .slice(0, 100)
      .map((item) => {
        const expression = object(item);
        return {
          id: string(expression.id, 80),
          description: string(expression.description, 4000),
          image: string(expression.image, 300),
        };
      }),
    placement:
      value.placement &&
      ['scale', 'x', 'y'].every(
        (key) =>
          typeof object(value.placement)[key] === 'number' &&
          Number.isFinite(object(value.placement)[key]),
      )
        ? {
            scale: object(value.placement).scale as number,
            x: object(value.placement).x as number,
            y: object(value.placement).y as number,
          }
        : undefined,
    importedCard:
      card.version === 1 || card.version === 2
        ? {
            version: card.version,
            original: {},
            warnings: (Array.isArray(card.warnings) ? card.warnings : [])
              .slice(0, 100)
              .map((item) => string(item, 1000)),
          }
        : undefined,
  };
}
export function describeCharacter(input: unknown, content = false) {
  const character = diagnosticCharacter(input);
  const fields = {
    description: character.description,
    personality: character.personality ?? '',
    scenario: character.scenario ?? '',
    exampleMessages: character.exampleMessages ?? '',
    greeting: character.greeting ?? '',
  };
  const source = object(object(input).importedCard);
  const original = object(source.original);
  const cardData = source.version === 2 ? object(original.data) : original;
  return {
    id: character.id,
    name: character.name,
    fieldLengths: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, value.length]),
    ),
    ...(content ? { fields } : {}),
    defaultExpression: character.defaultExpression,
    expressions: character.expressions.map((entry) => ({
      id: entry.id,
      hasImage: !!entry.image,
      descriptionCharacters: entry.description.length,
      ...(content ? { description: entry.description, image: entry.image } : {}),
    })),
    hasBackground: !!character.background,
    ...(content ? { background: character.background, placement: character.placement } : {}),
    card: character.importedCard
      ? {
          version: character.importedCard.version,
          warnings: character.importedCard.warnings,
          sourceFields: Object.keys(cardData).slice(0, 100),
        }
      : null,
  };
}
