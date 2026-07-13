export interface AlignmentBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AlignmentGuide {
  position: number;
  from: number;
  to: number;
}

export interface AlignmentGuides {
  vertical?: AlignmentGuide;
  horizontal?: AlignmentGuide;
}

export interface AlignmentSnapResult {
  position: { x: number; y: number };
  guides: AlignmentGuides;
}

interface AxisMatch {
  delta: number;
  position: number;
  target: AlignmentBox;
}

function nearestAxisMatch(
  movingAnchors: readonly number[],
  targets: readonly AlignmentBox[],
  targetAnchors: (target: AlignmentBox) => readonly number[],
  threshold: number,
): AxisMatch | undefined {
  let nearest: (AxisMatch & { distance: number }) | undefined;
  for (const target of targets) {
    for (const movingAnchor of movingAnchors) {
      for (const targetAnchor of targetAnchors(target)) {
        const delta = targetAnchor - movingAnchor;
        const distance = Math.abs(delta);
        if (distance > threshold || (nearest !== undefined && distance >= nearest.distance)) continue;
        nearest = { delta, distance, position: targetAnchor, target };
      }
    }
  }
  return nearest;
}

export function snapToAlignment(
  moving: AlignmentBox,
  targets: readonly AlignmentBox[],
  threshold = 6,
): AlignmentSnapResult {
  const verticalMatch = nearestAxisMatch(
    [moving.x, moving.x + moving.width / 2, moving.x + moving.width],
    targets,
    (target) => [target.x, target.x + target.width / 2, target.x + target.width],
    threshold,
  );
  const horizontalMatch = nearestAxisMatch(
    [moving.y, moving.y + moving.height / 2, moving.y + moving.height],
    targets,
    (target) => [target.y, target.y + target.height / 2, target.y + target.height],
    threshold,
  );
  const x = moving.x + (verticalMatch?.delta ?? 0);
  const y = moving.y + (horizontalMatch?.delta ?? 0);
  const guides: AlignmentGuides = {};

  if (verticalMatch !== undefined) {
    guides.vertical = {
      position: verticalMatch.position,
      from: Math.min(y, verticalMatch.target.y),
      to: Math.max(y + moving.height, verticalMatch.target.y + verticalMatch.target.height),
    };
  }
  if (horizontalMatch !== undefined) {
    guides.horizontal = {
      position: horizontalMatch.position,
      from: Math.min(x, horizontalMatch.target.x),
      to: Math.max(x + moving.width, horizontalMatch.target.x + horizontalMatch.target.width),
    };
  }

  return { position: { x, y }, guides };
}
