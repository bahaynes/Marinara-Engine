// ──────────────────────────────────────────────
// D&D 5.5e Object-Oriented AoE Template Strategy Pattern
// ──────────────────────────────────────────────

import type { DndSpell } from "../dnd-combat/types.js";
import type { DndGridCoord, DndTacticalMap, DndAoEShape } from "./types.js";

/**
 * Abstract Base AoE Measurement & Targeting Template
 * Encapsulates geometric calculations, coordinate checks, and display formatting.
 */
export abstract class AoETemplate {
  abstract readonly shape: DndAoEShape;
  abstract readonly sizeFt: number;
  abstract readonly originType: "target" | "self";

  constructor(public readonly size: number) {}

  /** Convert feet into 5ft battlemap grid units */
  protected toGridUnits(feet: number): number {
    return Math.max(1, Math.round(feet / 5));
  }

  /** Check if a coordinate is within tactical map bounds */
  protected isInBounds(x: number, y: number, map: DndTacticalMap): boolean {
    return x >= 0 && x < map.width && y >= 0 && y < map.height;
  }

  /** Calculate all grid coordinates affected by this template */
  abstract getAffectedTiles(
    targetCoord: DndGridCoord,
    map: DndTacticalMap,
    casterCoord?: DndGridCoord,
  ): DndGridCoord[];

  abstract getDisplayLabel(): string;
  abstract getIcon(): string;
}

/**
 * Sphere / Radius Template (e.g. Fireball, Hunger of Hadar, Darkness)
 * Centered on target point with circular Euclidean radius.
 */
export class SphereTemplate extends AoETemplate {
  readonly shape: DndAoEShape = "sphere";
  readonly sizeFt: number;
  readonly originType = "target" as const;

  constructor(radiusFt: number = 20) {
    super(radiusFt);
    this.sizeFt = radiusFt;
  }

  getAffectedTiles(targetCoord: DndGridCoord, map: DndTacticalMap): DndGridCoord[] {
    const affected: DndGridCoord[] = [];
    const radiusUnits = this.sizeFt / 5;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const dist = Math.hypot(x - targetCoord.x, y - targetCoord.y);
        if (dist <= radiusUnits + 0.35) {
          affected.push({ x, y });
        }
      }
    }
    return affected;
  }

  getDisplayLabel(): string {
    return `${this.sizeFt}ft Radius (Sphere)`;
  }

  getIcon(): string {
    return "💥";
  }
}

/**
 * Cylinder Template (e.g. Moonbeam, Call Lightning, Flame Strike)
 * Projected as a 2D circular column on the ground plane.
 */
export class CylinderTemplate extends AoETemplate {
  readonly shape: DndAoEShape = "cylinder";
  readonly sizeFt: number;
  readonly originType = "target" as const;

  constructor(radiusFt: number = 10) {
    super(radiusFt);
    this.sizeFt = radiusFt;
  }

  getAffectedTiles(targetCoord: DndGridCoord, map: DndTacticalMap): DndGridCoord[] {
    const affected: DndGridCoord[] = [];
    const radiusUnits = this.sizeFt / 5;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const dist = Math.hypot(x - targetCoord.x, y - targetCoord.y);
        if (dist <= radiusUnits + 0.35) {
          affected.push({ x, y });
        }
      }
    }
    return affected;
  }

  getDisplayLabel(): string {
    return `${this.sizeFt}ft Cylinder`;
  }

  getIcon(): string {
    return "🌀";
  }
}

/**
 * Cone Template (e.g. Burning Hands, Cone of Cold, Dragon's Breath, Fear)
 * Originates from the caster's position and expands in a 90-degree arc towards the target aim point.
 */
export class ConeTemplate extends AoETemplate {
  readonly shape: DndAoEShape = "cone";
  readonly sizeFt: number;
  readonly originType = "self" as const;

  constructor(lengthFt: number = 15) {
    super(lengthFt);
    this.sizeFt = lengthFt;
  }

  getAffectedTiles(
    targetCoord: DndGridCoord,
    map: DndTacticalMap,
    casterCoord?: DndGridCoord,
  ): DndGridCoord[] {
    const affected: DndGridCoord[] = [];
    if (!casterCoord) return [{ ...targetCoord }];

    const lengthUnits = this.sizeFt / 5;
    const aimAngle = Math.atan2(targetCoord.y - casterCoord.y, targetCoord.x - casterCoord.x);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const dist = Math.hypot(x - casterCoord.x, y - casterCoord.y);
        if (dist > 0 && dist <= lengthUnits + 0.35) {
          const tileAngle = Math.atan2(y - casterCoord.y, x - casterCoord.x);
          let diff = Math.abs(tileAngle - aimAngle);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;

          // 90-degree cone (pi/4 radians on each side of aim vector)
          if (diff <= Math.PI / 4 + 0.1) {
            affected.push({ x, y });
          }
        }
      }
    }
    return affected;
  }

  getDisplayLabel(): string {
    return `${this.sizeFt}ft Cone`;
  }

  getIcon(): string {
    return "📐";
  }
}

/**
 * Line Template (e.g. Lightning Bolt, Aganazzar's Scorcher, Gust of Wind, Sunbeam)
 * Originates from the caster and travels along the target aim ray for the full specified length.
 */
export class LineTemplate extends AoETemplate {
  readonly shape: DndAoEShape = "line";
  readonly sizeFt: number;
  readonly originType = "self" as const;

  constructor(lengthFt: number = 60) {
    super(lengthFt);
    this.sizeFt = lengthFt;
  }

  getAffectedTiles(
    targetCoord: DndGridCoord,
    map: DndTacticalMap,
    casterCoord?: DndGridCoord,
  ): DndGridCoord[] {
    const affected: DndGridCoord[] = [];
    if (!casterCoord) return [{ ...targetCoord }];

    const steps = this.toGridUnits(this.sizeFt);
    const dx = targetCoord.x - casterCoord.x;
    const dy = targetCoord.y - casterCoord.y;
    const len = Math.hypot(dx, dy) || 1;
    const normX = dx / len;
    const normY = dy / len;

    for (let step = 1; step <= steps; step++) {
      const tx = Math.round(casterCoord.x + normX * step);
      const ty = Math.round(casterCoord.y + normY * step);

      if (this.isInBounds(tx, ty, map)) {
        if (!affected.some((a) => a.x === tx && a.y === ty)) {
          affected.push({ x: tx, y: ty });
        }
      }
    }
    return affected;
  }

  getDisplayLabel(): string {
    return `${this.sizeFt}ft Line`;
  }

  getIcon(): string {
    return "⚡";
  }
}

/**
 * Cube Template (e.g. Thunderwave, Faerie Fire, Hypnotic Pattern, Web)
 * Centered on target point with square width/height bounds.
 */
export class CubeTemplate extends AoETemplate {
  readonly shape: DndAoEShape = "cube";
  readonly sizeFt: number;
  readonly originType = "target" as const;

  constructor(sideLengthFt: number = 15) {
    super(sideLengthFt);
    this.sizeFt = sideLengthFt;
  }

  getAffectedTiles(targetCoord: DndGridCoord, map: DndTacticalMap): DndGridCoord[] {
    const affected: DndGridCoord[] = [];
    const sideUnits = this.toGridUnits(this.sizeFt);
    const halfUnits = Math.floor(sideUnits / 2);

    for (let dy = -halfUnits; dy <= halfUnits; dy++) {
      for (let dx = -halfUnits; dx <= halfUnits; dx++) {
        const tx = targetCoord.x + dx;
        const ty = targetCoord.y + dy;

        if (this.isInBounds(tx, ty, map)) {
          if (!affected.some((a) => a.x === tx && a.y === ty)) {
            affected.push({ x: tx, y: ty });
          }
        }
      }
    }
    return affected;
  }

  getDisplayLabel(): string {
    return `${this.sizeFt}ft Cube`;
  }

  getIcon(): string {
    return "⏹️";
  }
}

/**
 * AoE Template Factory
 * Polymorphically instantiates any geometric template with dynamic dimensions.
 */
export class AoETemplateFactory {
  static create(shape: DndAoEShape, sizeFt: number): AoETemplate {
    switch (shape) {
      case "cone":
        return new ConeTemplate(sizeFt);
      case "line":
        return new LineTemplate(sizeFt);
      case "cube":
        return new CubeTemplate(sizeFt);
      case "cylinder":
        return new CylinderTemplate(sizeFt);
      case "sphere":
      case "single":
      default:
        return new SphereTemplate(sizeFt);
    }
  }

  /** Resolve the polymorphic template configured on any D&D spell */
  static fromSpell(spell: DndSpell): AoETemplate | null {
    if (!spell.isAoE && !spell.aoeShape) return null;
    const shape = spell.aoeShape || "sphere";
    const sizeFt = spell.aoeRadiusFt || 20;
    return AoETemplateFactory.create(shape, sizeFt);
  }
}
