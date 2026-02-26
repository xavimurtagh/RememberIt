# RememberIt — YouTube Retention Chrome Extension

## Vision

**RememberIt** is a Chrome extension that combats passive video consumption by transforming YouTube videos into active learning experiences. When watching a video, users can generate AI-powered flashcards from the video's content and review them using a scientifically-proven spaced repetition algorithm (FSRS). The goal: you don't just watch — you *remember*.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Scientific Foundation](#2-scientific-foundation)
3. [Product Overview](#3-product-overview)
4. [User Flows](#4-user-flows)
5. [Architecture](#5-architecture)
6. [Feature Specification](#6-feature-specification)
7. [Data Models](#7-data-models)
8. [Tech Stack](#8-tech-stack)
9. [Project Structure](#9-project-structure)
10. [Implementation Phases](#10-implementation-phases)
11. [Open Questions & Future Scope](#11-open-questions--future-scope)

---

## 1. Problem Statement

Social media and short-form content are eroding attention spans. People watch hours of YouTube — educational videos, tutorials, lectures, documentaries — and retain almost nothing within days. There's no friction between consuming and forgetting.

**The core insight:** Passive watching is terrible for memory. Active recall with spaced repetition is the single most effective evidence-based technique for long-term retention.

**The gap:** No existing tool tightly integrates AI-generated flashcards *from the video you just watched* with a proper spaced repetition review system, all within the YouTube experience itself.

---

## 2. Scientific Foundation

### The Forgetting Curve (Ebbinghaus, 1885)

Without reinforcement, memory decays exponentially. Within 24 hours, ~70% of newly learned material is forgotten. Within a week, ~90% is gone. The only proven countermeasure is **spaced review at increasing intervals**.

### Active Recall vs. Passive Review

Research consistently shows that *testing yourself* on material (active recall) produces dramatically stronger memories than re-reading or re-watching (passive review). The "testing effect" is one of the most robust findings in cognitive psychology.

### Spaced Repetition — FSRS Algorithm

We will use the **FSRS (Free Spaced Repetition Scheduler)** algorithm, which is the state-of-the-art:

- **Created in 2023** using machine learning trained on 700 million reviews from 20,000 users
- **20-30% fewer reviews** needed vs. SM-2 (Anki's legacy algorithm) for equivalent retention
- **99.6% superiority** over SM-2 in benchmark testing
- **Personalizes** to each user's memory patterns via the DSR model (Difficulty, Stability, Retrievability)
- **Open-source TypeScript implementation** available: [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) on npm

The FSRS algorithm predicts *when* a user will forget each specific flashcard and schedules the review at the optimal moment — right before the memory fades.

### Why Flashcards From Video Content?

- Forces **encoding** — transforming video into Q&A pairs requires comprehension
- Enables **active recall** — the user must retrieve answers, not passively re-watch
- Supports **spaced repetition** — cards are scheduled for review over days/weeks/months
- **Timestamps** link cards back to the source video moment for context

---

## 3. Product Overview

### What It Is

A Chrome extension with a **side panel** that lives alongside YouTube. When a user is watching a video they want to remember, they click "Generate Flashcards." The extension:

1. Extracts the video's transcript (captions/subtitles)
2. Sends it to an AI (Claude API) to generate high-quality Q&A flashcards
3. Saves the flashcards to the user's local database
4. Schedules reviews using the FSRS algorithm
5. Presents review sessions in the side panel (on YouTube or anywhere)

### Core Value Proposition

> "Watch a video. Get tested on it. Actually remember it."

### Key Principles

- **Minimal friction** — One click to generate cards. Review sessions take 2-5 minutes.
- **Science-backed** — FSRS, not arbitrary intervals. Active recall, not passive summaries.
- **Privacy-first** — All data stored locally (IndexedDB). No accounts needed for core functionality.
- **YouTube-native** — Lives in the side panel, not a separate app. Cards link back to video timestamps.

---

## 4. User Flows

### Flow 1: First-Time Setup

```
Install extension → Open YouTube → Side panel auto-hints on first video
→ User sees welcome message + brief explanation → Setup complete
```

### Flow 2: Generate Flashcards From a Video

```
User watches YouTube video → Clicks RememberIt icon/button on YouTube page
→ Side panel opens → Shows video title + "Generate Flashcards" button
→ User clicks → Loading state ("Extracting transcript...")
→ AI generates 5-15 flashcards from transcript
→ Cards displayed in side panel with preview
→ User can edit/delete/add cards before saving
→ Clicks "Save to My Library" → Cards added with FSRS scheduling
→ (Optional) User does an immediate first review
```

### Flow 3: Daily Review Session

```
User opens any page (or YouTube) → Clicks RememberIt icon
→ Side panel shows "You have X cards due for review"
→ User clicks "Start Review" → Sees question side of first card
→ Thinks/recalls answer → Clicks "Show Answer"
→ Sees answer + (optional) link to video timestamp
→ Rates recall: Again / Hard / Good / Easy
→ FSRS calculates next review date → Next card shown
→ Repeat until all due cards reviewed
→ "Session complete! X cards reviewed. Next review: tomorrow."
```

### Flow 4: Browse Video Library

```
User opens side panel → Navigates to "My Library" tab
→ Sees list of all videos with flashcards
→ Each video shows: title, thumbnail, # of cards, next review date
→ User can tap into a video to see its flashcards
→ Can edit, delete, or add cards manually
→ Can re-generate cards from transcript
→ Can jump to the video at a card's timestamp
```

### Flow 5: Review from a Specific Video Page

```
User is on a YouTube video they've already generated cards for
→ Side panel shows "You have X cards from this video due"
→ User can review just this video's cards
→ Or review all due cards across all videos
```

---

## 5. Architecture

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    CHROME EXTENSION                       │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Content       │  │ Side Panel   │  │ Service       │  │
│  │ Script        │  │ (React)      │  │ Worker        │  │
│  │               │  │              │  │               │  │
│  │ • Inject UI   │  │ • Flashcard  │  │ • AI API      │  │
│  │   button on   │  │   generation │  │   calls       │  │
│  │   YouTube     │  │ • Review UI  │  │ • Transcript  │  │
│  │ • Extract     │  │ • Library    │  │   extraction  │  │
│  │   video meta  │  │ • Stats      │  │ • FSRS engine │  │
│  │ • Detect      │  │ • Settings   │  │ • Badge/notif │  │
│  │   navigation  │  │              │  │   management  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘  │
│         │                 │                  │           │
│         └────────── Message Passing ─────────┘           │
│                           │                              │
│                    ┌──────┴──────┐                        │
│                    │  IndexedDB  │                        │
│                    │  (Dexie.js) │                        │
│                    │             │                        │
│                    │ • Videos    │                        │
│                    │ • Cards     │                        │
│                    │ • Reviews   │                        │
│                    │ • Settings  │                        │
│                    └─────────────┘                        │
│                                                          │
└──────────────────────────────────────────────────────────┘
                            │
                   ┌────────┴────────┐
                   │   External AI   │
                   │   API (Claude)  │
                   │                 │
                   │  Transcript →   │
                   │  Flashcards     │
                   └─────────────────┘
```

### Component Responsibilities

| Component | Role | Key Details |
|-----------|------|-------------|
| **Content Script** | Injects into YouTube pages | Adds "RememberIt" button near subscribe/like buttons. Extracts video ID, title, channel. Detects page navigation (YouTube is an SPA). |
| **Side Panel** | Main UI surface | React app rendered in Chrome's Side Panel API. Houses all user-facing features: generation, review, library, stats, settings. |
| **Service Worker** | Background orchestration | Handles AI API calls (keeps API key out of content scripts). Runs FSRS scheduling calculations. Manages extension badge (due card count). Coordinates transcript extraction. |
| **IndexedDB (via Dexie.js)** | Persistent local storage | All user data stored locally. Dexie.js provides a clean Promise-based wrapper. Supports complex queries needed for FSRS scheduling. |

### Communication Flow

```
Content Script ←──chrome.runtime.sendMessage──→ Service Worker
Side Panel     ←──chrome.runtime.sendMessage──→ Service Worker
Side Panel     ←──Direct IndexedDB access────→ IndexedDB
Service Worker ←──fetch()────────────────────→ AI API
```

---

## 6. Feature Specification

### 6.1 Transcript Extraction

**Approach:** Hybrid strategy for maximum reliability.

**Primary — YouTube Innertube API (from content script):**
- Extract the `ytInitialPlayerResponse` object from the YouTube page's DOM
- Parse out the `captionTracks` array from `playerCaptionsTracklistRenderer`
- Fetch the transcript XML from the caption track URL
- Parse XML into structured segments: `{ text, start, duration }`
- This works for both manual captions and auto-generated captions

**Fallback — DOM scraping:**
- Programmatically click "Show transcript" in the YouTube UI
- Read from the `ytd-transcript-segment-list-renderer` container
- Parse segment text and timestamps

**Output format:**
```typescript
interface TranscriptSegment {
  text: string;       // The spoken text
  start: number;      // Start time in seconds
  duration: number;   // Duration in seconds
}

interface VideoTranscript {
  videoId: string;
  title: string;
  channel: string;
  language: string;
  segments: TranscriptSegment[];
  fullText: string;   // All segments joined
}
```

**Edge cases to handle:**
- Video has no captions → Show clear error: "This video doesn't have captions available"
- Auto-generated captions only → Proceed (they're good enough for flashcard generation)
- Multiple languages available → Default to video's language, allow user selection
- Very long videos (2+ hours) → Chunk transcript for AI processing

---

### 6.2 AI Flashcard Generation

**API:** Claude API (Anthropic) — user provides their own API key in settings.

**Prompt strategy:**
- Send transcript (or chunked sections for long videos) with video metadata
- Request structured JSON output: array of `{ question, answer, timestamp, topic }` objects
- Guide the AI to produce cards that test *understanding*, not just surface recall
- Cards should reference specific concepts, not vague generalities
- Include the approximate timestamp so cards can link back to the video moment

**Card types to generate:**
1. **Concept cards** — "What is [concept] and why does it matter?"
2. **Application cards** — "How would you apply [technique] to [scenario]?"
3. **Comparison cards** — "What's the difference between [X] and [Y]?"
4. **Key fact cards** — "What statistic/finding did the speaker cite about [topic]?"

**Configuration:**
- Number of cards: Auto (based on video length) or user-specified (5-20)
- Difficulty level: Beginner / Intermediate / Advanced
- Focus areas: User can optionally specify topics to focus on

**Prompt template (example):**
```
You are generating flashcards to help someone remember the key concepts
from a YouTube video.

Video: "{title}" by {channel}
Transcript:
---
{transcript_text}
---

Generate {count} flashcards as a JSON array. Each flashcard should:
- Test understanding, not just recognition
- Be self-contained (answerable without re-watching)
- Include the approximate timestamp (seconds) of the relevant section
- Cover the most important and memorable concepts
- Vary in type: concept definitions, applications, comparisons, key facts

Output format:
[
  {
    "question": "...",
    "answer": "...",
    "timestamp": 125,
    "topic": "short topic label"
  }
]
```

**Post-generation user controls:**
- Preview all generated cards before saving
- Edit question or answer text inline
- Delete unwanted cards
- Add custom cards manually
- Regenerate cards with different settings

---

### 6.3 Spaced Repetition Review System (FSRS)

**Library:** [`ts-fsrs`](https://www.npmjs.com/package/ts-fsrs) (official TypeScript implementation)

**Review flow:**
1. User opens review session → query all cards where `nextReviewDate <= now`
2. Present cards one at a time: question → (user thinks) → show answer
3. User rates their recall:
   - **Again** (0) — Complete blank, couldn't recall → review again soon
   - **Hard** (1) — Struggled significantly, partial recall → shorter interval
   - **Good** (2) — Recalled with some effort → standard interval
   - **Easy** (3) — Instant, effortless recall → longer interval
4. FSRS computes the next review date based on the rating and card's history
5. Card state and scheduling parameters are updated in IndexedDB

**FSRS integration:**
```typescript
import { createEmptyCard, fsrs, generatorParameters, Rating } from 'ts-fsrs';

// Initialize FSRS with default parameters (personalizes over time)
const params = generatorParameters();
const scheduler = fsrs(params);

// When user rates a card
const scheduling = scheduler.repeat(card, now);
const updatedCard = scheduling[Rating.Good].card; // or Hard, Easy, Again
const reviewLog = scheduling[Rating.Good].log;
```

**Review session options:**
- **All due cards** — Review everything that's due across all videos
- **Video-specific** — Review only cards from the current/selected video
- **Quick review** — Limit to 10-20 cards for a short session
- **Cram mode** — Review cards not yet due (for pre-test cramming)

**Badge notification:**
- Extension badge shows number of due cards (updated via service worker alarm)
- Updates every hour or when the extension is activated

---

### 6.4 Side Panel UI

**Framework:** React + TypeScript with Tailwind CSS

**Tabs/Views:**

#### Home / Dashboard
- Cards due count with "Start Review" CTA
- Current streak (consecutive days with reviews)
- Quick stats: total cards, total videos, retention rate
- Recently added videos

#### Review View
- Clean, focused card display
- Question shown first, large and centered
- "Show Answer" button
- Answer revealed with rating buttons: Again / Hard / Good / Easy
- Progress bar (3/15 cards reviewed)
- Session summary at the end

#### Generate View (appears when on a YouTube video page)
- Video title + thumbnail
- "Generate Flashcards" button
- Settings: card count, difficulty, focus topics
- Card preview/edit list after generation
- "Save to Library" button

#### Library View
- List of all saved videos, sorted by next review date
- Each entry: thumbnail, title, channel, card count, next review
- Search/filter by title or channel
- Tap to expand → see all cards for that video
- Edit/delete individual cards
- Delete entire video's cards

#### Stats View
- Review history calendar (GitHub-style heatmap)
- Retention rate over time (line chart)
- Cards by maturity (new / learning / mature)
- Reviews per day trend
- Streak counter

#### Settings View
- AI API key configuration (stored in chrome.storage.local, encrypted)
- Target retention rate (FSRS parameter, default 90%)
- Default card count per video
- Review reminders (on/off, time of day)
- Theme (light/dark/system)
- Export/import data (JSON)
- Clear all data

---

### 6.5 YouTube Page Integration (Content Script)

**Injected UI elements:**

1. **"RememberIt" button** — Placed near the subscribe/like buttons below the video
   - Click opens the side panel with the Generate view
   - If cards already exist for this video, shows a dot indicator
   - Visually consistent with YouTube's button style

2. **Review nudge** (subtle) — If the user has due cards and is on YouTube, show a small non-intrusive banner: "You have X cards to review"

**SPA navigation handling:**
- YouTube is a Single Page Application — navigating between videos doesn't trigger page reloads
- Content script must observe URL changes (via `yt-navigate-finish` event or MutationObserver)
- Re-inject/update UI elements on each navigation

---

### 6.6 Card-to-Timestamp Linking

When reviewing a card, the user can click "Watch this part" to:
1. Open the source YouTube video in a new tab (or navigate current tab)
2. Jump to the timestamp associated with that flashcard
3. URL format: `https://www.youtube.com/watch?v={videoId}&t={timestamp}s`

This is valuable when a user gets a card wrong and wants to re-learn the concept from the source.

---

## 7. Data Models

### IndexedDB Schema (via Dexie.js)

```typescript
// === Videos Table ===
interface Video {
  id: string;              // YouTube video ID (primary key)
  title: string;
  channel: string;
  thumbnailUrl: string;
  duration: number;        // Video duration in seconds
  transcript: string;      // Full transcript text (for regeneration)
  language: string;
  createdAt: Date;
  cardCount: number;       // Denormalized for quick display
}

// === Cards Table ===
interface Card {
  id: string;              // UUID (primary key)
  videoId: string;         // FK → Videos.id (indexed)
  question: string;
  answer: string;
  timestamp: number;       // Seconds into the video
  topic: string;           // Short topic label

  // FSRS scheduling fields
  due: Date;               // When this card is next due
  stability: number;       // FSRS stability parameter
  difficulty: number;      // FSRS difficulty parameter
  elapsed_days: number;    // Days since last review
  scheduled_days: number;  // Days until next review (from last review)
  reps: number;            // Total number of reviews
  lapses: number;          // Number of times recalled incorrectly
  state: number;           // 0=New, 1=Learning, 2=Review, 3=Relearning
  last_review: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

// === Review Logs Table ===
interface ReviewLog {
  id: string;              // UUID (primary key)
  cardId: string;          // FK → Cards.id (indexed)
  videoId: string;         // FK → Videos.id (indexed, for per-video stats)
  rating: number;          // 0=Again, 1=Hard, 2=Good, 3=Easy
  state: number;           // Card state at time of review
  due: Date;               // When the card was due
  stability: number;       // Stability before review
  difficulty: number;      // Difficulty before review
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  reviewedAt: Date;        // When the review actually happened
}

// === Settings (chrome.storage.local) ===
interface Settings {
  apiKey: string;          // Claude API key (encrypted)
  targetRetention: number; // Default 0.9 (90%)
  defaultCardCount: number;// Default 10
  theme: 'light' | 'dark' | 'system';
  reviewReminder: boolean;
  reviewReminderTime: string; // HH:MM format
  dailyReviewGoal: number;   // Default 20
}
```

### Dexie.js Database Definition

```typescript
import Dexie, { Table } from 'dexie';

class RememberItDB extends Dexie {
  videos!: Table<Video>;
  cards!: Table<Card>;
  reviewLogs!: Table<ReviewLog>;

  constructor() {
    super('RememberItDB');
    this.version(1).stores({
      videos: 'id, createdAt',
      cards: 'id, videoId, due, state, createdAt',
      reviewLogs: 'id, cardId, videoId, reviewedAt'
    });
  }
}
```

---

## 8. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Extension framework** | Chrome Manifest V3 | Required for Chrome Web Store. Modern, secure. |
| **UI framework** | React 18 + TypeScript | Component-based, rich ecosystem, great for complex UIs. |
| **Styling** | Tailwind CSS | Rapid prototyping, consistent design, small bundle via purging. |
| **Build tool** | WXT (Vite-based) | Best-in-class extension framework for 2025+. File-based entrypoints, auto-manifest generation, fast HMR, type-safe messaging/storage. Smallest bundle sizes (~400KB). Framework-agnostic. |
| **Side Panel** | Chrome Side Panel API | Native Chrome API for persistent companion UIs. |
| **Database** | IndexedDB via Dexie.js | Large local storage, complex queries, no server needed. |
| **Spaced repetition** | `ts-fsrs` | Official FSRS TypeScript implementation. State-of-the-art algorithm. |
| **AI API** | Claude (Anthropic) | High-quality flashcard generation from transcripts. |
| **Charts** | Recharts (lightweight) | For stats/analytics visualizations. |
| **IDs** | `uuid` or `crypto.randomUUID()` | Unique card and review log identifiers. |

---

## 9. Project Structure

```
RememberIt/
├── public/
│   ├── icons/
│   │   ├── icon-16.png
│   │   ├── icon-32.png
│   │   ├── icon-48.png
│   │   └── icon-128.png
│   └── panel.html              # Side panel entry point
│
├── src/
│   ├── background/
│   │   ├── index.ts            # Service worker entry
│   │   ├── ai.ts               # Claude API integration
│   │   ├── transcript.ts       # Transcript fetching/parsing
│   │   ├── scheduler.ts        # FSRS scheduling logic
│   │   └── badge.ts            # Badge count management
│   │
│   ├── content/
│   │   ├── index.ts            # Content script entry
│   │   ├── inject-button.ts    # Inject RememberIt button on YouTube
│   │   ├── extract-metadata.ts # Extract video ID, title, channel
│   │   └── navigation.ts       # SPA navigation detection
│   │
│   ├── panel/                  # Side panel React app
│   │   ├── main.tsx            # React entry point
│   │   ├── App.tsx             # Root component with routing
│   │   ├── components/
│   │   │   ├── ReviewCard.tsx       # Flashcard display during review
│   │   │   ├── ReviewSession.tsx    # Review session orchestrator
│   │   │   ├── CardEditor.tsx       # Edit/create card form
│   │   │   ├── CardPreviewList.tsx  # Preview generated cards
│   │   │   ├── VideoList.tsx        # Library video list
│   │   │   ├── StatsCalendar.tsx    # GitHub-style review heatmap
│   │   │   ├── RetentionChart.tsx   # Retention over time chart
│   │   │   └── SettingsForm.tsx     # Settings configuration
│   │   ├── views/
│   │   │   ├── DashboardView.tsx
│   │   │   ├── ReviewView.tsx
│   │   │   ├── GenerateView.tsx
│   │   │   ├── LibraryView.tsx
│   │   │   ├── StatsView.tsx
│   │   │   └── SettingsView.tsx
│   │   ├── hooks/
│   │   │   ├── useCards.ts          # Card CRUD operations
│   │   │   ├── useReview.ts         # Review session state
│   │   │   ├── useScheduler.ts      # FSRS scheduling hook
│   │   │   ├── useVideos.ts         # Video CRUD operations
│   │   │   └── useStats.ts          # Statistics queries
│   │   └── styles/
│   │       └── index.css            # Tailwind imports + custom styles
│   │
│   ├── db/
│   │   ├── database.ts         # Dexie.js database definition
│   │   ├── videos.ts           # Video data access layer
│   │   ├── cards.ts            # Card data access layer
│   │   └── reviewLogs.ts       # Review log data access layer
│   │
│   ├── shared/
│   │   ├── types.ts            # Shared TypeScript interfaces
│   │   ├── constants.ts        # App-wide constants
│   │   └── messages.ts         # Message types for chrome.runtime
│   │
│   └── utils/
│       ├── transcript-parser.ts  # Parse transcript XML/JSON
│       ├── prompt-builder.ts     # Build AI prompts for card generation
│       └── time.ts               # Time/date formatting utilities
│
├── wxt.config.ts               # WXT configuration (auto-generates manifest)
├── tailwind.config.js
├── tsconfig.json
├── package.json
└── PLAN.md
```

---

## 10. Implementation Phases

### Phase 1: Foundation (MVP Core)

**Goal:** Working extension that can extract transcripts and generate flashcards from a YouTube video.

| Task | Details |
|------|---------|
| **1.1 Project scaffolding** | Initialize WXT + React + TypeScript + Tailwind. WXT auto-generates manifest from file-based entrypoints. Configure permissions: `sidePanel`, `activeTab`, `storage`. Set up project structure. |
| **1.2 Content script — YouTube integration** | Inject "RememberIt" button on YouTube video pages. Extract video ID, title, channel from the page. Handle YouTube SPA navigation (`yt-navigate-finish`). Send video metadata to service worker via `chrome.runtime.sendMessage`. |
| **1.3 Transcript extraction** | Parse `ytInitialPlayerResponse` for caption track URLs. Fetch and parse caption XML into structured segments. Handle edge cases: no captions, auto-generated only, language selection. |
| **1.4 Side panel — basic UI** | Set up Side Panel with React. Create tab navigation (Generate / Review / Library). Build Generate view: video info display, "Generate Flashcards" button, loading state. |
| **1.5 AI flashcard generation** | Claude API integration in service worker. Prompt engineering for high-quality Q&A pairs with timestamps. Parse AI response into structured Card objects. Display generated cards in side panel for preview. |
| **1.6 IndexedDB setup** | Initialize Dexie.js database with Videos, Cards, ReviewLogs tables. Implement CRUD operations for videos and cards. Save generated flashcards to database. |

**Deliverable:** User can click button on YouTube → side panel opens → cards are generated from transcript → cards are saved locally.

---

### Phase 2: Review System

**Goal:** Full spaced repetition review system with FSRS scheduling.

| Task | Details |
|------|---------|
| **2.1 FSRS integration** | Install and configure `ts-fsrs`. Wrap FSRS in a scheduling service. Initialize new cards with FSRS empty card state. |
| **2.2 Review session UI** | Build ReviewCard component (question → reveal → rate). Build ReviewSession orchestrator (card queue, progress bar). Rating buttons: Again / Hard / Good / Easy. Session summary screen with stats. |
| **2.3 Due card queries** | Query cards where `due <= now` sorted by due date. Support filtering by video. Update badge count via service worker alarm (hourly). |
| **2.4 Card editing** | Inline editing of question/answer text in library. Manual card creation form. Delete individual cards. |
| **2.5 Library view** | List all saved videos with metadata. Expand to see cards per video. Search/filter functionality. Delete video and all its cards. |

**Deliverable:** Full review loop works — cards are scheduled, presented for review, rated, and rescheduled by FSRS.

---

### Phase 3: Polish & Analytics

**Goal:** Stats, quality-of-life features, and visual polish.

| Task | Details |
|------|---------|
| **3.1 Dashboard** | Due cards count + "Start Review" CTA. Current streak display. Quick stats summary. Recent videos list. |
| **3.2 Statistics view** | Review heatmap calendar (Recharts). Retention rate over time chart. Card maturity breakdown (new/learning/mature). Reviews per day. |
| **3.3 Timestamp linking** | "Watch this part" button on cards during review. Opens YouTube video at the card's timestamp. Visual timestamp badge on cards in library. |
| **3.4 Settings** | API key management (encrypted storage). Target retention rate slider. Default card count. Theme toggle (light/dark/system). Data export/import (JSON). |
| **3.5 Review reminders** | Chrome notification at user-configured time. "You have X cards due" with action to open side panel. |
| **3.6 Visual polish** | Consistent design system. Animations/transitions for card flips and reveals. Responsive layout for different side panel widths. Loading skeletons. Error states. |

**Deliverable:** Polished, feature-complete extension ready for personal use or early testing.

---

### Phase 4: Advanced Features (Post-MVP)

| Feature | Details |
|---------|---------|
| **Cram mode** | Review cards not yet due (before a test/meeting). |
| **Card tags/topics** | Group and filter cards by topic across videos. |
| **AI regeneration** | Regenerate cards with different difficulty/focus. |
| **Video summary** | In addition to cards, show a concise AI summary of the video. |
| **Keyboard shortcuts** | 1/2/3/4 for ratings, Space to reveal, arrow keys for navigation. |
| **Data sync** | Optional cloud sync for cross-device usage (future consideration). |
| **Firefox support** | Port to Firefox using WebExtensions API. |
| **Export to Anki** | Export cards as `.apkg` file for Anki users. |

---

## 11. Competitive Landscape & Differentiation

### Existing Tools

| Tool | What It Does | What It's Missing |
|------|-------------|-------------------|
| **Glasp / YouTube Summary with ChatGPT** | Summarizes YouTube transcripts. 2M+ users. | No flashcards. No spaced repetition. Summary-only = passive. |
| **Eightify** | AI video summaries (ChatGPT/Claude). Up to 10hr videos. | No active recall. No review scheduling. Summary = passive consumption. |
| **Knowt** | Generates flashcards + quizzes from video lectures. | Separate platform (not in-browser). No FSRS. Basic SRS at best. |
| **RemNote** | Paste YouTube link → flashcards + built-in SRS. | Desktop app, not a Chrome extension. Requires switching context away from YouTube. |
| **Anki** | Gold standard SRS (now with FSRS). | No YouTube integration. No AI card generation. Manual card creation. Steep learning curve. |
| **Web Highlights** | Summarize + highlight videos, articles, PDFs. | No flashcards. No spaced repetition. |

### RememberIt's Differentiators

1. **YouTube-native** — Lives in the side panel *while you watch*. No context switching.
2. **AI → Flashcards** (not just summaries) — Active recall, not passive reading.
3. **FSRS** — State-of-the-art scheduling. Not a basic Leitner box or arbitrary intervals.
4. **Timestamp linking** — Every card connects back to the exact moment in the video.
5. **Privacy-first** — All data local. No account. BYOK for AI.
6. **One product, complete loop** — Generate → Review → Remember. No stitching tools together.

---

## 12. Service Worker Best Practices

Since Manifest V3 service workers terminate when idle, the following patterns are critical:

- **Persist all state** — Never rely on in-memory variables. Use IndexedDB or `chrome.storage` for anything that matters.
- **Use `chrome.alarms`** — For periodic tasks (badge count updates, review reminders) instead of `setInterval` which doesn't survive worker termination.
- **Event-driven design** — React to events (`chrome.runtime.onMessage`, `chrome.alarms.onAlarm`) rather than polling.
- **Reconstruct on wake** — Service worker must be able to fully reconstruct its operational state from storage on every startup.
- **No remote code execution** — All logic must be bundled with the extension. AI API *responses* (data) are fine; executable code from external sources is not.

---

## 13. Open Questions & Future Scope

### Open Questions (To Decide Before/During Implementation)

1. **API Key model:** Should we require users to bring their own Claude API key, or should we provide a hosted backend with authentication?
   - *Recommendation:* Start with BYOK (Bring Your Own Key) for simplicity and privacy. No backend needed.

2. **Transcript language handling:** Should we auto-translate non-English transcripts, or generate cards in the video's language?
   - *Recommendation:* Generate cards in the transcript's language. Let the AI handle it.

3. **Long video handling:** For 2+ hour videos, should we process the entire transcript or let users select sections?
   - *Recommendation:* Auto-chunk long transcripts and process in segments. Merge results.

4. **Card quality vs. quantity:** Should we prioritize fewer, higher-quality cards or more comprehensive coverage?
   - *Recommendation:* Default to ~1 card per 2-3 minutes of video. Quality over quantity. Users can request more.

### Future Scope

- **Other platforms:** Extend to Vimeo, Coursera, Khan Academy, podcast platforms
- **Study groups:** Share card decks with friends / study groups
- **Mobile companion app:** Review cards on mobile (React Native or PWA)
- **LLM-enhanced review:** AI evaluates free-text answers instead of self-rating
- **Content graph:** Map relationships between concepts across videos
- **Browser-level integration:** Integrate with Chrome's built-in AI APIs (Gemini Nano) when available for on-device card generation

---

## Summary

RememberIt transforms passive YouTube watching into active learning by combining three proven techniques:

1. **AI-powered content extraction** — Transcripts become flashcards automatically
2. **Active recall testing** — Users test themselves instead of re-watching
3. **FSRS spaced repetition** — Reviews are scheduled at scientifically optimal intervals

The extension lives natively in Chrome's side panel, requires no account, stores all data locally, and respects user privacy. The tech stack (React + TypeScript + Vite + CRXJS + ts-fsrs + Dexie.js) is modern, well-supported, and optimized for Chrome extension development.

The phased implementation approach delivers a working MVP in Phase 1, adds the core review system in Phase 2, polishes with analytics in Phase 3, and expands with advanced features in Phase 4.
