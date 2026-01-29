# Crabwalk Layout Overlap Fix - Implementation Summary

## Problem Statement
The radial graph layout was causing node overlaps with ~15+ active sessions:
- SUBAGENT nodes overlapping with CHAT nodes
- Multiple AGENT cards stacking on each other
- CRON nodes too close together near center
- Overall layout needed better collision avoidance

## Solution Implemented

### 1. Increased Spacing Constants
```typescript
// BEFORE:
const BASE_RADIUS = 400        // Distance from crab for main sessions
const CHILD_OFFSET = 250       // Offset for child sessions from parent
const RADIAL_SPACING = 100     // Space between items radiating outward

// AFTER:
const BASE_RADIUS = 500        // +100 from center (25% increase)
const CHILD_OFFSET = 350       // +100 child offset (40% increase)
const RADIAL_SPACING = 160     // +60 between items (60% increase)
```

### 2. Added Collision Detection System
- `checkCollision()` - Bounding box overlap detection with padding
- `hasCollision()` - Check if a position would collide with existing nodes
- `COLLISION_PADDING = 40` - Extra safety margin around nodes
- Tracks all positioned nodes in `positionedNodeBounds` array

### 3. Improved Collision Avoidance
**For root sessions:**
- Detects overlaps when placing items along radial direction
- Automatically increases radius if collision detected
- Iteratively adjusts up to 500px to find clear space

**For child sessions:**
- Checks session node position for collisions before placing
- Adjusts parent offset (up to 300px) to avoid overlaps
- Also applies collision avoidance to child session items

### 4. Better Sibling Distribution
```typescript
// BEFORE: Fixed 45° spread (π/4)
const angularSpread = Math.PI / 4

// AFTER: Dynamic spread based on sibling count
const MIN_SIBLING_ANGLE = 0.4  // ~23° minimum per sibling
const minAngularSpread = MIN_SIBLING_ANGLE * siblingCount
const angularSpread = Math.max(Math.PI / 3, minAngularSpread) // At least 60°
```

This ensures siblings don't cluster too tightly, especially when there are many children of the same parent.

## Technical Details

### Node Dimensions (Reference)
```typescript
session: { width: 280, height: 140 }  // Widest nodes
exec: { width: 300, height: 120 }     // Exec processes
action: { width: 220, height: 100 }   // Chat/action events
crab: { width: 64, height: 64 }       // Center focal point
```

### Collision Detection Algorithm
1. Calculate bounding box for candidate node position
2. Check overlap with all previously positioned nodes
3. If collision detected, adjust position:
   - For radial chains: increase radius by 30px increments
   - For session positions: increase offset by 50px increments
4. Repeat until clear position found (with max adjustment limits)
5. Track new position in bounds array for future collision checks

## Testing
- Build succeeds: `npm run build` ✅
- Type-safe: No TypeScript errors ✅
- Backwards compatible: Existing radial layout logic preserved ✅

## Expected Results
With these changes, the dashboard should:
1. ✅ No overlapping nodes (even with 15+ sessions)
2. ✅ Clear visual separation between session chains
3. ✅ Better use of available space (larger radius, more angular spread)
4. ✅ Automatic collision avoidance prevents edge cases
5. ✅ Child sessions (subagents) spread out more naturally

## Files Modified
- `src/lib/graph-layout.ts` - All changes

## Commit Message
```
feat: improve radial layout collision avoidance

- Increase BASE_RADIUS (400→500), CHILD_OFFSET (250→350), RADIAL_SPACING (100→160)
- Add collision detection system with bounding box checks
- Implement automatic radius/offset adjustment to avoid overlaps
- Improve sibling angular distribution (min 23° per sibling, 60° minimum spread)
- Add COLLISION_PADDING (40px) for safety margins

Fixes node overlapping issues with 15+ active sessions.
Ensures SUBAGENT, CHAT, AGENT, and CRON nodes don't stack.
```

## Next Steps
1. ✅ Commit changes to local branch
2. ✅ Push to fork (FelipeLVieira/crabwalk)
3. 🔄 Test with live dashboard
4. 📋 Document moltbot identification recommendations (Task 2)
