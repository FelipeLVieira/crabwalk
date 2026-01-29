# Crabwalk Layout Overlap Analysis

## Current Layout Issues

### Problems Identified from Screenshot:
1. **Insufficient spacing** - RADIAL_SPACING = 100 is too small for nodes with 100-140 height
2. **No collision detection** - Nodes can overlap when siblings spawn near each other
3. **Child session clustering** - Multiple children of same parent use only 45° spread (π/4)
4. **Action/exec chain overlaps** - Items within a session can overlap with neighboring sessions

### Current Constants:
```typescript
const BASE_RADIUS = 400        // Distance from crab for main sessions
const CHILD_OFFSET = 250       // Offset for child sessions from parent
const RADIAL_SPACING = 100     // Space between items radiating outward (TOO SMALL!)
```

### Node Dimensions:
```typescript
session: { width: 280, height: 140 }
exec: { width: 300, height: 120 }
action: { width: 220, height: 100 }
crab: { width: 64, height: 64 }
```

## Proposed Fixes

### 1. Increase Spacing Constants
```typescript
const BASE_RADIUS = 500           // +100 from center
const CHILD_OFFSET = 350          // +100 child offset
const RADIAL_SPACING = 160        // +60 between items (was 100)
const MIN_SIBLING_ANGLE = 0.4     // ~23° minimum angle between siblings
```

### 2. Add Collision Detection
Implement a collision avoidance system that:
- Checks if node positions overlap with existing nodes
- Adjusts position by increasing radius or angle offset
- Uses bounding boxes with padding for detection

### 3. Better Sibling Distribution
Instead of cramming siblings into 45° spread:
- Calculate angular space needed based on sibling count
- Ensure minimum angle separation (MIN_SIBLING_ANGLE)
- Increase radius if siblings can't fit in angular spread

### 4. Session Chain Length Consideration
Long chains of actions/execs extend far from session node:
- Calculate total chain length before placing session
- Reserve angular space proportional to chain length
- Avoid placing sessions with long chains too close together

## Implementation Plan

1. Update spacing constants (quick win)
2. Add collision detection helper function
3. Improve sibling placement algorithm
4. Test with current ~15 sessions
5. Commit and push to fork
