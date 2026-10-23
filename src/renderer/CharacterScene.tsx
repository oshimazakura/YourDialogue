import type { Character } from '../shared/types.ts';
import { defaultPlacement } from '../core/characters.ts';

export function CharacterScene({
  character,
  expression,
  preview = false,
}: {
  character: Character;
  expression: string;
  preview?: boolean;
}) {
  const placement = character.placement ?? defaultPlacement;
  const sprite =
    character.expressions.find((item) => item.id === expression)?.image ??
    character.expressions.find((item) => item.id === character.defaultExpression)?.image ??
    '';
  return (
    <>
      <div className={`scene ${character.background ? 'has-background' : ''}`} aria-hidden="true">
        {character.background ? (
          <img className="scene-image" src={character.background} alt="" />
        ) : (
          <>
            <div className="scene-window" />
            <div className="scene-horizon" />
            <div className="scene-floor" />
          </>
        )}
        <div className="scene-light" />
      </div>
      <div className={`stage ${preview ? 'preview-stage' : ''}`}>
        <div className="character-halo" />
        {sprite ? (
          <img
            className="character"
            src={sprite}
            alt={`${character.name}の立ち絵`}
            draggable={false}
            style={{
              left: `${placement.x}%`,
              bottom: `${placement.y}%`,
              height: `${placement.scale * 100}%`,
              right: 'auto',
              minHeight: 0,
              maxHeight: 'none',
              transform: 'translateX(-50%)',
            }}
          />
        ) : (
          <div className="no-character">立ち絵は未登録です</div>
        )}
      </div>
    </>
  );
}
