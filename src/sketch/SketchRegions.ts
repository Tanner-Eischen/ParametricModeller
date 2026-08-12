import type { NormalizedSketchGeometry } from './NormalizedSketch';
import { toProfileSegments } from './NormalizedSketch';
import {
  analyzeProfiles,
  type AnalyzedProfile,
  type ProfileAnalysisOptions,
  type ProfileIssue,
} from './ProfileAnalyzer';
import type { Point2D } from './SketchTypes';

/** Stable region selection independent of profile array ordering. */
export interface SketchRegionRef {
  sketchId: string;
  regionId: string;
  outerSegmentIds: string[];
  holeSegmentIds: string[][];
  /** Legacy fallback only; new references resolve by stable topology IDs. */
  profileIndex?: number;
}

export interface AnalyzedSketchRegion {
  id: string;
  ref: SketchRegionRef;
  outerLoop: Point2D[];
  holeLoops: Point2D[][];
  /** Ordered outer boundary segment IDs. */
  outerSegmentIds: string[];
  /** Ordered segment IDs for each hole boundary. */
  holeSegmentIds: string[][];
  area: number;
}

export interface SketchRegionAnalysis {
  regions: AnalyzedSketchRegion[];
  issues: ProfileIssue[];
}

/** Analyze non-construction geometry into stable, hole-aware selectable regions. */
export function analyzeNormalizedSketchRegions(
  sketchId: string,
  geometry: NormalizedSketchGeometry,
  options: ProfileAnalysisOptions = {}
): SketchRegionAnalysis {
  const profileAnalysis = analyzeProfiles(toProfileSegments(geometry), options);
  const profiles = profileAnalysis.profiles;
  const containersByProfile = new Map<AnalyzedProfile, AnalyzedProfile[]>();

  for (const profile of profiles) {
    const containers = profiles
      .filter(
        (candidate) =>
          candidate !== profile
          && candidate.area > profile.area
          && pointInPolygon(profile.loop[0]!, candidate.loop)
      )
      .sort((left, right) => left.area - right.area || left.id.localeCompare(right.id));
    containersByProfile.set(profile, containers);
  }

  const regionRecords = profiles.flatMap((outer, profileIndex): AnalyzedSketchRegion[] => {
    const containers = containersByProfile.get(outer) ?? [];
    if (containers.length % 2 !== 0) return [];

    const holes = profiles
      .filter((candidate) => {
        const candidateContainers = containersByProfile.get(candidate) ?? [];
        return candidateContainers.length === containers.length + 1
          && candidateContainers[0] === outer;
      })
      .sort((left, right) => left.id.localeCompare(right.id));
    const outerSegmentIds = [...outer.entityIds];
    const holeSegmentIds = holes.map((hole) => [...hole.entityIds]);
    const regionId = createSketchRegionId(outerSegmentIds, holeSegmentIds);
    const ref: SketchRegionRef = {
      sketchId,
      regionId,
      outerSegmentIds: [...outerSegmentIds].sort(),
      holeSegmentIds: holeSegmentIds
        .map((ids) => [...ids].sort())
        .sort(compareIdLists),
      profileIndex,
    };
    return [{
      id: regionId,
      ref,
      outerLoop: outer.loop.map(copyPoint),
      holeLoops: holes.map((hole) => hole.loop.map(copyPoint)),
      outerSegmentIds,
      holeSegmentIds,
      area: outer.area - holes.reduce((sum, hole) => sum + hole.area, 0),
    }];
  });

  return {
    regions: regionRecords.sort((left, right) => left.id.localeCompare(right.id)),
    issues: profileAnalysis.issues.map(cloneIssue),
  };
}

export function createSketchRegionRef(
  sketchId: string,
  outerSegmentIds: readonly string[],
  holeSegmentIds: readonly (readonly string[])[] = [],
  profileIndex?: number
): SketchRegionRef {
  const canonicalOuter = uniqueSorted(outerSegmentIds);
  const canonicalHoles = holeSegmentIds
    .map(uniqueSorted)
    .sort(compareIdLists);
  return {
    sketchId,
    regionId: createSketchRegionId(canonicalOuter, canonicalHoles),
    outerSegmentIds: canonicalOuter,
    holeSegmentIds: canonicalHoles,
    ...(isValidProfileIndex(profileIndex) ? { profileIndex } : {}),
  };
}

/** Adapt old `profileIndex` selections without pretending they are topology-stable. */
export function createLegacySketchRegionRef(
  sketchId: string,
  profileIndex: number
): SketchRegionRef {
  return {
    sketchId,
    regionId: '',
    outerSegmentIds: [],
    holeSegmentIds: [],
    profileIndex: isValidProfileIndex(profileIndex) ? profileIndex : 0,
  };
}

export function resolveSketchRegionRef(
  ref: SketchRegionRef,
  analysis: SketchRegionAnalysis
): AnalyzedSketchRegion | null {
  if (ref.regionId) {
    return analysis.regions.find(
        (region) =>
          region.ref.sketchId === ref.sketchId
          && (
            region.id === ref.regionId
            || sameRegionTopology(region.ref, ref)
          )
      )
      ?? null;
  }

  return isValidProfileIndex(ref.profileIndex)
    ? analysis.regions.find(
        (region) =>
          region.ref.sketchId === ref.sketchId
          && region.ref.profileIndex === ref.profileIndex
      ) ?? null
    : null;
}

export function createSketchRegionId(
  outerSegmentIds: readonly string[],
  holeSegmentIds: readonly (readonly string[])[]
): string {
  const outerKey = uniqueSorted(outerSegmentIds).join('|');
  const holeKey = holeSegmentIds
    .map((ids) => uniqueSorted(ids).join('|'))
    .sort()
    .join('::');
  return holeKey
    ? `region:${outerKey}::holes:${holeKey}`
    : `region:${outerKey}`;
}

function sameRegionTopology(left: SketchRegionRef, right: SketchRegionRef): boolean {
  return idListsEqual(left.outerSegmentIds, right.outerSegmentIds)
    && nestedIdListsEqual(left.holeSegmentIds, right.holeSegmentIds);
}

function nestedIdListsEqual(
  left: readonly (readonly string[])[],
  right: readonly (readonly string[])[]
): boolean {
  const canonicalLeft = left.map(uniqueSorted).sort(compareIdLists);
  const canonicalRight = right.map(uniqueSorted).sort(compareIdLists);
  return canonicalLeft.length === canonicalRight.length
    && canonicalLeft.every((ids, index) => idListsEqual(ids, canonicalRight[index] ?? []));
}

function idListsEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  const canonicalLeft = uniqueSorted(left);
  const canonicalRight = uniqueSorted(right);
  return canonicalLeft.length === canonicalRight.length
    && canonicalLeft.every((id, index) => id === canonicalRight[index]);
}

function pointInPolygon(point: Point2D, loop: readonly Point2D[]): boolean {
  let inside = false;
  for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index++) {
    const currentPoint = loop[index]!;
    const previousPoint = loop[previous]!;
    const crosses = (currentPoint[1] > point[1]) !== (previousPoint[1] > point[1])
      && point[0] < (
        (previousPoint[0] - currentPoint[0])
        * (point[1] - currentPoint[1])
        / (previousPoint[1] - currentPoint[1])
        + currentPoint[0]
      );
    if (crosses) inside = !inside;
  }
  return inside;
}

function cloneIssue(issue: ProfileIssue): ProfileIssue {
  return {
    ...issue,
    entityIds: [...issue.entityIds],
    ...(issue.point ? { point: copyPoint(issue.point) } : {}),
  };
}

function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function compareIdLists(left: readonly string[], right: readonly string[]): number {
  return left.join('|').localeCompare(right.join('|'));
}

function isValidProfileIndex(value: number | undefined): value is number {
  return Number.isInteger(value) && (value ?? -1) >= 0;
}

function copyPoint(point: Point2D): Point2D {
  return [point[0], point[1]];
}
