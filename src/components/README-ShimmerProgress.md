# ShimmerProgressComponent

A React component that provides smooth, non-jarring visual feedback during browser research operations with proper state transitions, real-time fact counter updates, source quality indicators, and graceful error states.

## Features

- **Smooth State Transitions**: Animated transitions between research phases (planning, searching, analyzing, synthesizing)
- **Real-time Progress Updates**: Live fact counter and source display with smooth animations
- **Confidence Indicator**: Visual confidence meter showing research quality
- **Source Quality Display**: Shows current sources being investigated with quality scores
- **Error State Handling**: Graceful error display with optional retry functionality
- **Accessibility**: Proper ARIA labels and semantic HTML

## Usage

### Basic Usage

```tsx
import { ShimmerProgressComponent, ResearchState } from './ShimmerProgressComponent';

const state: ResearchState = {
  phase: 'analyzing',
  currentSources: [
    {
      url: 'https://example.com/article',
      title: 'Research Article',
      qualityScore: 85,
      factsExtracted: 3,
      visitedAt: Date.now()
    }
  ],
  factsFound: 5,
  confidence: 0.75
};

<ShimmerProgressComponent state={state} />
```

### With Error Handling

```tsx
<ShimmerProgressComponent
  state={state}
  error="Failed to connect to research sources"
  onRetry={() => console.log('Retrying...')}
/>
```

### With Custom Styling

```tsx
<ShimmerProgressComponent
  state={state}
  className="my-custom-class"
/>
```

## Props

### `ShimmerProgressComponentProps`

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `state` | `ResearchState` | Yes | Current research state including phase, sources, facts, and confidence |
| `error` | `string` | No | Error message to display (shows error state when provided) |
| `onRetry` | `() => void` | No | Callback function for retry button (button only shown if provided) |
| `className` | `string` | No | Additional CSS classes to apply to the component |

### `ResearchState`

| Property | Type | Description |
|----------|------|-------------|
| `phase` | `'planning' \| 'searching' \| 'analyzing' \| 'synthesizing'` | Current research phase |
| `currentSources` | `SourceInfo[]` | Array of sources currently being investigated |
| `factsFound` | `number` | Total number of facts extracted |
| `confidence` | `number` | Research confidence level (0-1) |

### `SourceInfo`

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string` | Source URL |
| `title` | `string` | Source title |
| `qualityScore` | `number` | Quality score (0-100) |
| `factsExtracted` | `number` | Number of facts extracted from this source |
| `visitedAt` | `number` | Timestamp when source was visited |

## Research Phases

The component supports four research phases, each with its own visual styling:

1. **Planning** (Blue): Initial research planning phase
2. **Searching** (Purple): Searching for relevant sources
3. **Analyzing** (Green): Analyzing page content
4. **Synthesizing** (Orange): Synthesizing findings into final answer

## Confidence Levels

The confidence indicator shows different colors based on the confidence value:

- **High** (≥0.8): Green - High confidence in results
- **Good** (≥0.6): Blue - Good confidence in results
- **Medium** (≥0.4): Yellow - Medium confidence in results
- **Low** (<0.4): Orange - Low confidence in results

## Animation Features

### Smooth Transitions

- Phase changes animate smoothly without jarring jumps
- Fact counter increments with smooth number animation
- Confidence bar fills smoothly with easing
- Sources appear/disappear with fade and slide animations

### Real-time Updates

- Fact counter updates in real-time as facts are extracted
- Source list updates dynamically as new sources are added
- Confidence indicator updates smoothly as confidence changes

## Source Display

- Shows up to 3 sources at a time
- Displays source title, hostname, and quality score
- Shows "+X more" indicator when more than 3 sources exist
- Each source has a quality score badge

## Error State

When an error occurs:

- Displays red error state with alert icon
- Shows error message
- Optionally shows retry button (if `onRetry` prop provided)
- Replaces normal progress display

## Integration with Enhanced Browser Research System

This component is designed to integrate with the Enhanced Browser Research System:

```tsx
import { ShimmerProgressComponent } from './ShimmerProgressComponent';
import { ResearchState, ProgressEvent } from './ShimmerProgressComponent';

// In your research orchestrator
const updateProgress = (event: ProgressEvent) => {
  // Update state based on event type
  switch (event.type) {
    case 'page_visited':
      // Add source to currentSources
      break;
    case 'fact_extracted':
      // Increment factsFound
      break;
    case 'source_scored':
      // Update source quality score
      break;
    case 'synthesis_started':
      // Change phase to 'synthesizing'
      break;
  }
};

// Render component
<ShimmerProgressComponent state={researchState} />
```

## Testing

The component includes comprehensive tests covering:

- Phase display for all research phases
- Fact counter display and updates
- Source display and quality scores
- Confidence indicator labels and colors
- Error state display and retry functionality
- Smooth transitions between states
- Accessibility features
- Custom className application

Run tests with:

```bash
npm test -- ShimmerProgressComponent.test.tsx
```

## Demo

A demo component is available at `ShimmerProgressDemo.tsx` that shows the component in action with simulated research progress.

## Requirements Validation

This component validates the following requirements from the Enhanced Browser Research System:

- **Requirement 2.1**: Displays current research phase
- **Requirement 2.2**: Updates fact counter in real-time
- **Requirement 2.3**: Smooth state transitions without jarring jumps
- **Requirement 2.4**: Displays current sources being investigated
- **Requirement 2.5**: Updates confidence indicator
- **Requirement 2.6**: Displays graceful error state

## Design Properties

This component implements the following correctness properties:

- **Property 10**: Shimmer Phase Display - Displays current phase
- **Property 11**: Shimmer Fact Counter Updates - Updates fact counter in real-time
- **Property 12**: Shimmer Source Display - Displays current sources
- **Property 13**: Shimmer Confidence Updates - Updates confidence indicator

## Dependencies

- React 18+
- Framer Motion (for animations)
- Lucide React (for icons)
- Tailwind CSS (for styling)
- `animated-loading-svg-text-shimmer` (for Loader component)

## Browser Support

Works in all modern browsers that support:
- CSS Grid
- CSS Flexbox
- CSS Transitions
- CSS Animations
- ES6+ JavaScript

## Accessibility

- Uses semantic HTML elements
- Includes ARIA labels for screen readers
- Proper color contrast ratios
- Keyboard navigation support
- Focus indicators

## Performance

- Optimized animations using CSS transforms
- Efficient re-renders with React.memo patterns
- Smooth 60fps animations
- Minimal DOM updates

## License

Part of the Enhanced Browser Research System.
