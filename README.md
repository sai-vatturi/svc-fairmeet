# FairMeet Backend Service

Research-grade Node.js backend server for FairMeet - A Human-Centered Meeting Moderation System designed to promote equity and fairness in online meetings through real-time analytics and intelligent interventions.

## Core Features

### 🔐 Meeting Management
- ✅ **Auto-generated 6-digit meeting codes** - Unique, easy-to-share meeting IDs
- ✅ **Automatic role assignment** - First participant becomes moderator
- ✅ **Session persistence** - Meeting state maintained throughout session
- ✅ **Graceful cleanup** - Automatic cleanup on meeting end or disconnection

### 📡 Real-Time Communication
- ✅ **WebSocket (Socket.io)** - Bidirectional real-time updates
- ✅ **Event-driven architecture** - Efficient state synchronization
- ✅ **Broadcast system** - Selective event distribution (all/moderator/private)
- ✅ **Connection management** - Robust reconnection and error handling

### 📊 Research-Grade Metrics
- ✅ **Gini coefficient calculation** - Statistical measure of inequality (0-1 scale)
- ✅ **Dominance index** - Ratio of max speaker to total duration
- ✅ **Participation entropy** - Shannon entropy for diversity measurement
- ✅ **Fairness score** - Composite metric (1 - Gini) for user-friendly display
- ✅ **Real-time updates** - Metrics recalculated on every speaking status change

### 👤 Participant Tracking
- ✅ **Speaking time accumulation** - Precise millisecond-level tracking
- ✅ **Status monitoring** - Speaking/muted/video states
- ✅ **Queue management** - Raise hand and speaking order
- ✅ **Activity detection** - Idle and active participant identification

### 🔔 Intelligent Interventions
- ✅ **Private nudge system** - Contextual prompts to encourage/moderate
- ✅ **Long-turn detection** - Alert when participant speaks >60s continuously
- ✅ **Quiet participant identification** - Detect under-participating members
- ✅ **Moderator notifications** - Real-time alerts for queue and interventions

### 🤖 AI Integration
- ✅ **Google Gemini API** - AI-powered icebreaker generation
- ✅ **Randomization system** - Unique questions every time (seed + timestamp)
- ✅ **Fallback questions** - Graceful degradation if API unavailable
- ✅ **Contextual prompts** - Meeting-appropriate conversation starters

### 💾 Data Persistence
- ✅ **Transcript storage** - JSON files saved in `/transcripts` directory
- ✅ **Meeting summaries** - Complete session data for post-meeting analysis
- ✅ **Timestamped records** - Chronological event logging
- ✅ **Research data export** - Structured format for academic analysis

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file:

```env
PORT=3000
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

## Running

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

### REST API

- `GET /api/health` - Health check
- `GET /api/meetings/:code/summary` - Get meeting summary

### WebSocket Events

#### Client → Server

- `createMeeting` - Create new meeting
- `joinMeeting` - Join existing meeting
- `updateSpeakingStatus` - Update speaking status
- `raiseHand` - Add to queue
- `removeFromQueue` - Remove from queue
- `reorderQueue` - Reorder queue (moderator only)
- `sendNudge` - Send nudge to participant
- `endMeeting` - End meeting (moderator only)
- `leaveMeeting` - Leave meeting

#### Server → Client

- `meetingCreated` - Meeting created confirmation
- `meetingJoined` - Meeting joined confirmation
- `participantJoined` - New participant joined
- `participantLeft` - Participant left
- `participantUpdate` - Participant state update
- `fairnessUpdate` - Fairness metrics update
- `queueUpdate` - Queue state update
- `handRaised` - Hand raised notification (to moderator)
- `nudgeReceived` - Nudge received (private)
- `nudgeSent` - Nudge sent notification (to moderator)
- `longTurnDetected` - Long turn detected
- `meetingEnded` - Meeting ended
- `meetingState` - Current meeting state
- `error` - Error message

## Research Metrics

The backend implements research-grade fairness metrics based on the academic paper:

- **Gini Coefficient**: Measures inequality in speaking time distribution
- **Fairness Score**: F = 1 - G (0-1 scale, higher = more fair)
- **Participation Entropy**: Shannon entropy for participation diversity
- **Dominance Index**: Ratio of max speaking time to total duration
- **Long-Turn Detection**: Identifies continuous speaking > threshold (default 60s)

## Architecture

```
svc-fairmeet/
├── src/
│   ├── models/
│   │   └── Meeting.js          # Meeting model with state management
│   ├── services/
│   │   └── MeetingService.js   # Meeting service layer
│   ├── utils/
│   │   └── fairnessMetrics.js  # Research-grade fairness calculations
│   └── server.js               # Main server with WebSocket handlers
├── package.json
└── README.md
```

## Integration with Frontend

The frontend should connect to:
- **REST API**: `http://localhost:3000/api`
- **WebSocket**: `ws://localhost:3000`

See `README_BACKEND_READY.md` in the frontend for integration details.

